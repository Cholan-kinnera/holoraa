package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/mail"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

const (
	testOrigin     = "http://127.0.0.1:3000"
	testCookieName = "__Host-holoraa_session"
	testSecret     = "test-only-auth-secret-0123456789abcdef-placeholder"
)

// memSender keeps delivered messages in memory so tests can read the code.
type memSender struct {
	mu   sync.Mutex
	msgs []mail.Message
}

func (m *memSender) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.msgs = append(m.msgs, msg)
	return nil
}

var codeRE = regexp.MustCompile(`code is ([0-9]{6})\.`)

func (m *memSender) lastCode(t *testing.T) string {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.msgs) == 0 {
		t.Fatal("no message sent")
	}
	found := codeRE.FindStringSubmatch(m.msgs[len(m.msgs)-1].Text)
	if found == nil {
		t.Fatal("no code in message")
	}
	return found[1]
}

type authFixture struct {
	h    http.Handler
	mail *memSender
	logs *bytes.Buffer
	auth *auth.Service
}

func newAuthFixture(t *testing.T) authFixture {
	t.Helper()
	pool := testdb.Pool(t)
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	sender := &memSender{}
	svc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	h := NewRouter(Deps{
		Log:      log,
		Health:   health.New(pool, time.Second, log),
		Auth:     svc,
		Profiles: profile.NewRepo(pool),
		Security: Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
	})
	return authFixture{h: h, mail: sender, logs: &logs, auth: svc}
}

// do sends a request. body is JSON text or empty. cookie is optional.
func (f authFixture) do(method, target, body string, headers map[string]string, cookie *http.Cookie) *httptest.ResponseRecorder {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	req.RemoteAddr = "192.0.2.100:4444"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

const jsonCT = "application/json"

// signIn runs the full code flow and returns the session cookie.
func (f authFixture) signIn(t *testing.T, email string) *http.Cookie {
	t.Helper()
	rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"`+email+`"}`,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}
	var sent struct {
		ChallengeID string `json:"challengeId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sent); err != nil {
		t.Fatal(err)
	}
	code := f.mail.lastCode(t)
	rec = f.do(http.MethodPost, "/v1/auth/otp/verify",
		`{"challengeId":"`+sent.ChallengeID+`","code":"`+code+`"}`,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if c.Name == testCookieName {
			return c
		}
	}
	t.Fatal("verify did not set the session cookie")
	return nil
}

// csrf returns the CSRF token for a session cookie.
func (f authFixture) csrf(t *testing.T, cookie *http.Cookie) string {
	t.Helper()
	rec := f.do(http.MethodGet, "/v1/auth/session", "", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("session: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	return body.CSRFToken
}

func TestSendCodeRequiresAllowedOriginAndJSON(t *testing.T) {
	f := newAuthFixture(t)
	body := `{"email":"origin@example.test"}`

	if rec := f.do(http.MethodPost, "/v1/auth/otp", body, map[string]string{"Content-Type": jsonCT}, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("no Origin: %d, want 403", rec.Code)
	}
	if rec := f.do(http.MethodPost, "/v1/auth/otp", body,
		map[string]string{"Origin": "https://evil.example.test", "Content-Type": jsonCT}, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("foreign Origin: %d, want 403", rec.Code)
	}
	if rec := f.do(http.MethodPost, "/v1/auth/otp", body,
		map[string]string{"Origin": testOrigin, "Content-Type": "text/plain"}, nil); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain body: %d, want 415", rec.Code)
	}
	rec := f.do(http.MethodPost, "/v1/auth/otp", body,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("valid request: %d %s", rec.Code, rec.Body.String())
	}
}

func TestUnknownJSONFieldsAreRejected(t *testing.T) {
	f := newAuthFixture(t)
	rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"x@example.test","admin":true}`,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown field: %d, want 400", rec.Code)
	}
}

func TestSessionCookieAttributes(t *testing.T) {
	f := newAuthFixture(t)
	// Run the flow by hand so the raw Set-Cookie header of verify can be inspected.
	rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"cookie@example.test"}`,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	var sent struct {
		ChallengeID string `json:"challengeId"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	code := f.mail.lastCode(t)
	rec = f.do(http.MethodPost, "/v1/auth/otp/verify", `{"challengeId":"`+sent.ChallengeID+`","code":"`+code+`"}`,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, nil)
	header := strings.Join(rec.Header().Values("Set-Cookie"), "; ")
	for _, want := range []string{testCookieName + "=", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"} {
		if !strings.Contains(header, want) {
			t.Fatalf("Set-Cookie %q lacks %q", header, want)
		}
	}
	if strings.Contains(strings.ToLower(header), "domain=") {
		t.Fatalf("Set-Cookie %q must not set Domain", header)
	}
}

func TestSignInResponseHasNoProfileYetAndNoRawTokenInBody(t *testing.T) {
	f := newAuthFixture(t)
	cookie := f.signIn(t, "fresh@example.test")
	rec := f.do(http.MethodGet, "/v1/me", "", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/me: %d", rec.Code)
	}
	var body struct {
		User struct {
			Email           string  `json:"email"`
			Username        *string `json:"username"`
			ProfileComplete bool    `json:"profileComplete"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.User.Email != "fresh@example.test" || body.User.Username != nil || body.User.ProfileComplete {
		t.Fatalf("fresh profile = %+v", body.User)
	}
	if strings.Contains(rec.Body.String(), cookie.Value) {
		t.Fatal("the session token appears in a response body")
	}
}

func TestProtectedRoutesFailClosedWithProblemDetails(t *testing.T) {
	f := newAuthFixture(t)
	for _, target := range []string{"/v1/auth/session", "/v1/me", "/v1/users/anyone"} {
		rec := f.do(http.MethodGet, target, "", nil, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s without a session: %d, want 401", target, rec.Code)
		}
		if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
			t.Fatalf("%s content type = %q, want problem+json", target, got)
		}
	}
}

func TestProfileWritesNeedOriginAndCSRF(t *testing.T) {
	f := newAuthFixture(t)
	cookie := f.signIn(t, "csrf@example.test")
	token := f.csrf(t, cookie)
	body := `{"username":"csrf_user"}`

	if rec := f.do(http.MethodPatch, "/v1/me", body,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH without CSRF: %d, want 403", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", body,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": "forged"}, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH with a forged CSRF token: %d, want 403", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", body,
		map[string]string{"Content-Type": jsonCT, "X-CSRF-Token": token}, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH without Origin: %d, want 403", rec.Code)
	}
	rec := f.do(http.MethodPatch, "/v1/me", body,
		map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": token}, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH with origin and CSRF: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"username":"csrf_user"`) || !strings.Contains(rec.Body.String(), `"profileComplete":true`) {
		t.Fatalf("profile not updated: %s", rec.Body.String())
	}
}

func TestProfileValidationAndConflictsAreProblemDetails(t *testing.T) {
	f := newAuthFixture(t)
	a := f.signIn(t, "conflict-a@example.test")
	b := f.signIn(t, "conflict-b@example.test")
	headersA := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, a)}
	headersB := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, b)}

	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"taken_name"}`, headersA, a); rec.Code != http.StatusOK {
		t.Fatalf("first claim: %d %s", rec.Code, rec.Body.String())
	}
	rec := f.do(http.MethodPatch, "/v1/me", `{"username":"TAKEN_name"}`, headersB, b)
	if rec.Code != http.StatusConflict {
		t.Fatalf("taken username: %d, want 409", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("409 content type = %q", got)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"x"}`, headersB, b); rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid username: %d, want 400", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"email":"hijack@example.test"}`, headersB, b); rec.Code != http.StatusBadRequest {
		t.Fatalf("unknown field on PATCH: %d, want 400", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":null}`, headersB, b); rec.Code != http.StatusBadRequest {
		t.Fatalf("clearing username: %d, want 400", rec.Code)
	}
}

func TestPublicProfileNeedsSessionAndOmitsEmail(t *testing.T) {
	f := newAuthFixture(t)
	owner := f.signIn(t, "public-owner@example.test")
	h := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, owner)}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"public_owner"}`, h, owner); rec.Code != http.StatusOK {
		t.Fatalf("claim: %d", rec.Code)
	}
	viewer := f.signIn(t, "public-viewer@example.test")

	rec := f.do(http.MethodGet, "/v1/users/PUBLIC_owner", "", nil, viewer)
	if rec.Code != http.StatusOK {
		t.Fatalf("public profile: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "email") || strings.Contains(rec.Body.String(), "public-owner@example.test") {
		t.Fatalf("public profile exposes an email: %s", rec.Body.String())
	}
	if rec := f.do(http.MethodGet, "/v1/users/nobody_here", "", nil, viewer); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown username: %d, want 404", rec.Code)
	}
}

func TestLogoutRevokesTheSessionAndClearsTheCookie(t *testing.T) {
	f := newAuthFixture(t)
	cookie := f.signIn(t, "logout-http@example.test")
	h := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, cookie)}

	rec := f.do(http.MethodPost, "/v1/auth/logout", "", h, cookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
	}
	if cleared := strings.Join(rec.Header().Values("Set-Cookie"), "; "); !strings.Contains(cleared, "Max-Age=0") {
		t.Fatalf("logout did not clear the cookie: %q", cleared)
	}
	if rec := f.do(http.MethodGet, "/v1/auth/session", "", nil, cookie); rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked session: %d, want 401", rec.Code)
	}
}

func TestRateLimitResponseCarriesRetryAfter(t *testing.T) {
	f := newAuthFixture(t)
	h := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}
	if rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"cooldown-http@example.test"}`, h, nil); rec.Code != http.StatusAccepted {
		t.Fatalf("first send: %d", rec.Code)
	}
	rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"cooldown-http@example.test"}`, h, nil)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second send: %d, want 429", rec.Code)
	}
	if ra := rec.Header().Get("Retry-After"); ra == "" || ra == "0" {
		t.Fatalf("Retry-After = %q, want a positive number of seconds", ra)
	}
}

func TestGenericFailureDoesNotRevealWhyCodeFailed(t *testing.T) {
	f := newAuthFixture(t)
	h := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}
	if rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"generic@example.test"}`, h, nil); rec.Code != http.StatusAccepted {
		t.Fatalf("send: %d", rec.Code)
	}
	sent := f.mail.lastCode(t)
	// An unknown challenge and a wrong code for a real challenge give the same response.
	wrong := f.do(http.MethodPost, "/v1/auth/otp/verify",
		`{"challengeId":"00000000-0000-4000-8000-000000000000","code":"`+sent+`"}`, h, nil)
	other := f.do(http.MethodPost, "/v1/auth/otp/verify",
		`{"challengeId":"11111111-1111-4111-8111-111111111111","code":"999999"}`, h, nil)
	if wrong.Code != http.StatusUnauthorized || other.Code != http.StatusUnauthorized {
		t.Fatalf("codes = %d and %d, want both 401", wrong.Code, other.Code)
	}
	if wrong.Body.String() != other.Body.String() {
		t.Fatalf("responses differ and may reveal which part failed:\n%s\n%s", wrong.Body.String(), other.Body.String())
	}
}

func TestLogsNeverContainCodesTokensOrEmails(t *testing.T) {
	f := newAuthFixture(t)
	const email = "logs-private@example.test"
	h := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}
	rec := f.do(http.MethodPost, "/v1/auth/otp", `{"email":"`+email+`"}`, h, nil)
	var sent struct {
		ChallengeID string `json:"challengeId"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &sent)
	code := f.mail.lastCode(t)
	vrec := f.do(http.MethodPost, "/v1/auth/otp/verify", `{"challengeId":"`+sent.ChallengeID+`","code":"`+code+`"}`, h, nil)
	var token string
	for _, c := range vrec.Result().Cookies() {
		token = c.Value
	}
	logText := f.logs.String()
	for name, secret := range map[string]string{"email": email, "code": code, "token": token} {
		if secret != "" && strings.Contains(logText, secret) {
			t.Fatalf("the %s appears in the logs", name)
		}
	}
	if strings.Contains(logText, testSecret) {
		t.Fatal("the auth secret appears in the logs")
	}
}
