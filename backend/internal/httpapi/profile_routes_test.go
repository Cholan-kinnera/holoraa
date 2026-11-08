package httpapi

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

func TestProfileRoutesGetMe(t *testing.T) {
	f := newAuthFixture(t)

	// 1. Unauthenticated request fails closed
	rec := f.do(http.MethodGet, "/v1/me", "", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /v1/me without session: %d, want 401", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("content type = %q, want problem+json", rec.Header().Get("Content-Type"))
	}

	// 2. Fresh sign-in: profileComplete is false, username is null
	cookie := f.signIn(t, "onboarding-user@example.test")
	rec = f.do(http.MethodGet, "/v1/me", "", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/me fresh user: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		User struct {
			ID              string  `json:"id"`
			Email           string  `json:"email"`
			Username        *string `json:"username"`
			DisplayName     *string `json:"displayName"`
			Bio             *string `json:"bio"`
			AvatarURL       *string `json:"avatarUrl"`
			ProfileComplete bool    `json:"profileComplete"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.User.Email != "onboarding-user@example.test" {
		t.Fatalf("email = %q", res.User.Email)
	}
	if res.User.Username != nil {
		t.Fatalf("username = %v, want nil", res.User.Username)
	}
	if res.User.ProfileComplete {
		t.Fatal("profileComplete = true for fresh user, want false")
	}

	// 3. Update profile to claim a username
	csrf := f.csrf(t, cookie)
	headers := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": csrf,
	}
	patchRec := f.do(http.MethodPatch, "/v1/me", `{"username":"onboarded_user","displayName":"Onboarded"}`, headers, cookie)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("PATCH /v1/me: %d %s", patchRec.Code, patchRec.Body.String())
	}

	// 4. Verify profileComplete is now true
	rec = f.do(http.MethodGet, "/v1/me", "", nil, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/me after claim: %d", rec.Code)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.User.Username == nil || *res.User.Username != "onboarded_user" {
		t.Fatalf("username = %v, want 'onboarded_user'", res.User.Username)
	}
	if !res.User.ProfileComplete {
		t.Fatal("profileComplete = false after claiming username, want true")
	}
}

func TestProfileRoutesPatchMeValidationAndSecurity(t *testing.T) {
	f := newAuthFixture(t)
	cookie := f.signIn(t, "patch-validation@example.test")
	csrf := f.csrf(t, cookie)
	validHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": csrf,
	}

	// Unauthenticated
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"No Auth"}`, validHeaders, nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("PATCH without session: %d, want 401", rec.Code)
	}

	// Missing Origin
	noOrigin := map[string]string{"Content-Type": jsonCT, "X-CSRF-Token": csrf}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"No Origin"}`, noOrigin, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH without Origin: %d, want 403", rec.Code)
	}

	// Missing CSRF
	noCSRF := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"No CSRF"}`, noCSRF, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH without CSRF: %d, want 403", rec.Code)
	}

	// Forged CSRF
	forgedCSRF := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": "bad-token"}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"Forged CSRF"}`, forgedCSRF, cookie); rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH with forged CSRF: %d, want 403", rec.Code)
	}

	// Unknown field rejection
	if rec := f.do(http.MethodPatch, "/v1/me", `{"unknownField":"malicious"}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH with unknown field: %d, want 400", rec.Code)
	}

	// Reserved usernames rejected
	for _, reserved := range []string{"admin", "api", "holoraa", "me", "root", "support", "users", "v1"} {
		rec := f.do(http.MethodPatch, "/v1/me", `{"username":"`+reserved+`"}`, validHeaders, cookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("PATCH reserved username %q: %d, want 400", reserved, rec.Code)
		}
	}

	// Invalid username syntax
	for _, invalid := range []string{"ab", strings.Repeat("u", 33), "1start_with_digit", "has space", "dash-not-allowed"} {
		rec := f.do(http.MethodPatch, "/v1/me", `{"username":"`+invalid+`"}`, validHeaders, cookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("PATCH invalid username %q: %d, want 400", invalid, rec.Code)
		}
	}

	// Cannot clear username or displayName with null
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":null}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH null username: %d, want 400", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":null}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH null displayName: %d, want 400", rec.Code)
	}

	// Display name length limit (1-50 chars) and no control chars / newlines
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"`+strings.Repeat("a", 51)+`"}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH 51-char displayName: %d, want 400", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"Name\nWith\nNewlines"}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH displayName with newline: %d, want 400", rec.Code)
	}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"displayName":"Name\x07WithControl"}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH displayName with control char: %d, want 400", rec.Code)
	}

	// Bio length limit (> 160 chars)
	if rec := f.do(http.MethodPatch, "/v1/me", `{"bio":"`+strings.Repeat("b", 161)+`"}`, validHeaders, cookie); rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH 161-char bio: %d, want 400", rec.Code)
	}

	// Avatar URL security: non-https or local/internal hostnames rejected
	badAvatars := []string{
		"http://cdn.example.test/a.png",
		"javascript:alert(1)",
		"https://localhost/avatar.png",
		"https://127.0.0.1/avatar.png",
		"https://10.0.0.1/avatar.png",
		"https://172.16.0.1/avatar.png",
		"https://192.168.1.1/avatar.png",
		"https://169.254.169.254/avatar.png",
		"https://service.local/avatar.png",
		"https://service.internal/avatar.png",
		"https://service.lan/avatar.png",
		"https://unqualified-host/avatar.png",
		"https://user:pass@cdn.example.test/avatar.png",
		"https://cdn.example.test/avatar.png#fragment",
	}
	for _, bad := range badAvatars {
		rec := f.do(http.MethodPatch, "/v1/me", `{"avatarUrl":"`+bad+`"}`, validHeaders, cookie)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("PATCH unsafe avatar URL %q: %d, want 400", bad, rec.Code)
		}
	}

	// Successful update with valid fields
	validBody := `{"username":"patch_valid_user","displayName":"Valid Name","bio":"Valid bio with\ninternal newline","avatarUrl":"https://cdn.example.test/avatar.png"}`
	rec := f.do(http.MethodPatch, "/v1/me", validBody, validHeaders, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH valid profile: %d %s", rec.Code, rec.Body.String())
	}

	// Clearing bio and avatarUrl with explicit null
	clearBody := `{"bio":null,"avatarUrl":null}`
	rec = f.do(http.MethodPatch, "/v1/me", clearBody, validHeaders, cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH clear bio and avatar: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), `"bio":"`) || strings.Contains(rec.Body.String(), `"avatarUrl":"`) {
		t.Fatalf("fields not cleared: %s", rec.Body.String())
	}
}

func TestProfileRoutesUsernameCollisionConflict(t *testing.T) {
	f := newAuthFixture(t)
	userA := f.signIn(t, "user-a@example.test")
	userB := f.signIn(t, "user-b@example.test")
	headersA := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, userA)}
	headersB := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, userB)}

	// User A claims "grand_champion"
	recA := f.do(http.MethodPatch, "/v1/me", `{"username":"grand_champion"}`, headersA, userA)
	if recA.Code != http.StatusOK {
		t.Fatalf("user A claim: %d %s", recA.Code, recA.Body.String())
	}

	// User B tries to claim exact same username -> 409 Conflict
	recB := f.do(http.MethodPatch, "/v1/me", `{"username":"grand_champion"}`, headersB, userB)
	if recB.Code != http.StatusConflict {
		t.Fatalf("user B duplicate claim: %d, want 409", recB.Code)
	}
	if recB.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("content type = %q, want problem+json", recB.Header().Get("Content-Type"))
	}

	// User B tries to claim case variant "GRAND_champion" -> 409 Conflict
	recBCase := f.do(http.MethodPatch, "/v1/me", `{"username":"GRAND_champion"}`, headersB, userB)
	if recBCase.Code != http.StatusConflict {
		t.Fatalf("user B case variant claim: %d, want 409", recBCase.Code)
	}
}

func TestProfileRoutesGetPublicProfilePrivacyAndIsolation(t *testing.T) {
	f := newAuthFixture(t)
	targetUser := f.signIn(t, "target-private@example.test")
	viewerUser := f.signIn(t, "viewer@example.test")
	headersTarget := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, targetUser)}

	// Unauthenticated request to public profile returns 401
	rec := f.do(http.MethodGet, "/v1/users/target_handle", "", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /v1/users/{username} without session: %d, want 401", rec.Code)
	}

	// Target user has NOT claimed username yet (incomplete profile) -> 404 Not Found
	rec = f.do(http.MethodGet, "/v1/users/target-private", "", nil, viewerUser)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET incomplete profile: %d, want 404", rec.Code)
	}

	// Target user completes profile setup
	claimBody := `{"username":"target_handle","displayName":"Target User","bio":"A public bio","avatarUrl":"https://cdn.example.test/pic.png"}`
	recTarget := f.do(http.MethodPatch, "/v1/me", claimBody, headersTarget, targetUser)
	if recTarget.Code != http.StatusOK {
		t.Fatalf("target user claim: %d %s", recTarget.Code, recTarget.Body.String())
	}

	// Viewer fetches target user's public profile (case-insensitive)
	rec = f.do(http.MethodGet, "/v1/users/TARGET_HANDLE", "", nil, viewerUser)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET public profile: %d %s", rec.Code, rec.Body.String())
	}
	bodyStr := rec.Body.String()

	// Strict privacy check: email and sensitive internal fields must NEVER appear
	if strings.Contains(bodyStr, "target-private@example.test") || strings.Contains(bodyStr, "email") {
		t.Fatalf("public profile leaks email: %s", bodyStr)
	}
	if strings.Contains(bodyStr, "createdAt") || strings.Contains(bodyStr, "updatedAt") || strings.Contains(bodyStr, "lastSeenAt") {
		t.Fatalf("public profile leaks internal timestamps: %s", bodyStr)
	}

	// Verify exact public fields
	var pub struct {
		ID          string  `json:"id"`
		Username    string  `json:"username"`
		DisplayName *string `json:"displayName"`
		Bio         *string `json:"bio"`
		AvatarURL   *string `json:"avatarUrl"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pub); err != nil {
		t.Fatalf("unmarshal public profile: %v", err)
	}
	if pub.Username != "target_handle" {
		t.Fatalf("username = %q, want 'target_handle'", pub.Username)
	}
	if pub.DisplayName == nil || *pub.DisplayName != "Target User" {
		t.Fatalf("displayName = %v, want 'Target User'", pub.DisplayName)
	}
	if pub.Bio == nil || *pub.Bio != "A public bio" {
		t.Fatalf("bio = %v, want 'A public bio'", pub.Bio)
	}
	if pub.AvatarURL == nil || *pub.AvatarURL != "https://cdn.example.test/pic.png" {
		t.Fatalf("avatarUrl = %v, want 'https://cdn.example.test/pic.png'", pub.AvatarURL)
	}

	// Non-existent username returns 404
	rec = f.do(http.MethodGet, "/v1/users/non_existent_ghost", "", nil, viewerUser)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET non-existent profile: %d, want 404", rec.Code)
	}
}

func TestProfileRoutesSearchUsers(t *testing.T) {
	f := newAuthFixture(t)
	caller := f.signIn(t, "search-caller@example.test")
	headersCaller := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, caller)}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"caller_user"}`, headersCaller, caller); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}

	userA := f.signIn(t, "usera@example.test")
	headersA := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, userA)}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"alice_springs","displayName":"Alice Springs","bio":"Bio A","avatarUrl":"https://cdn.example.test/a.png"}`, headersA, userA); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}

	userB := f.signIn(t, "userb@example.test")
	headersB := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": f.csrf(t, userB)}
	if rec := f.do(http.MethodPatch, "/v1/me", `{"username":"alex_morgan","displayName":"Alex Morgan"}`, headersB, userB); rec.Code != http.StatusOK {
		t.Fatal(rec.Body.String())
	}

	// Incomplete user (username is null)
	_ = f.signIn(t, "incomplete@example.test")

	// 1. Unauthenticated request -> 401 Unauthorized
	rec := f.do(http.MethodGet, "/v1/users?q=al", "", nil, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("search without session: %d, want 401", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("expected problem+json, got %q", rec.Header().Get("Content-Type"))
	}

	// 2. Empty / whitespace queries return 200 OK with empty array
	for _, q := range []string{"", " ", "   ", "\t", "\n"} {
		rec = f.do(http.MethodGet, "/v1/users?q="+url.QueryEscape(q), "", nil, caller)
		if rec.Code != http.StatusOK {
			t.Fatalf("search empty query %q: %d", q, rec.Code)
		}
		var emptyRes struct {
			Users []profile.UserSummary `json:"users"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &emptyRes); err != nil {
			t.Fatal(err)
		}
		if len(emptyRes.Users) != 0 {
			t.Fatalf("expected 0 users for empty query, got %d", len(emptyRes.Users))
		}
	}

	// 3. Prefix search (1-2 chars): "al"
	rec = f.do(http.MethodGet, "/v1/users?q=al", "", nil, caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("search prefix: %d %s", rec.Code, rec.Body.String())
	}
	var prefixRes struct {
		Users []profile.UserSummary `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &prefixRes); err != nil {
		t.Fatal(err)
	}
	if len(prefixRes.Users) != 2 {
		t.Fatalf("expected 2 users for 'al', got %d: %+v", len(prefixRes.Users), prefixRes.Users)
	}

	// 4. Trigram search (3+ chars): "alice"
	rec = f.do(http.MethodGet, "/v1/users?q=alice", "", nil, caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("search trigram: %d %s", rec.Code, rec.Body.String())
	}
	var triRes struct {
		Users []profile.UserSummary `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &triRes); err != nil {
		t.Fatal(err)
	}
	if len(triRes.Users) != 1 || triRes.Users[0].Username != "alice_springs" {
		t.Fatalf("expected 'alice_springs', got %+v", triRes.Users)
	}

	// 5. Caller exclusion: caller searches "caller" -> 0 results
	rec = f.do(http.MethodGet, "/v1/users?q=caller", "", nil, caller)
	if rec.Code != http.StatusOK {
		t.Fatalf("search caller: %d", rec.Code)
	}
	var callerRes struct {
		Users []profile.UserSummary `json:"users"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &callerRes); err != nil {
		t.Fatal(err)
	}
	if len(callerRes.Users) != 0 {
		t.Fatalf("caller was not excluded: %+v", callerRes.Users)
	}

	// 6. Privacy isolation: verify no email or timestamps in JSON
	rawJSON := rec.Body.String()
	if strings.Contains(rawJSON, "email") || strings.Contains(rawJSON, "example.test") {
		t.Fatalf("email leaked in search response: %s", rawJSON)
	}
	if strings.Contains(rawJSON, "createdAt") || strings.Contains(rawJSON, "updatedAt") {
		t.Fatalf("timestamps leaked in search response: %s", rawJSON)
	}

	// 7. Invalid query limits
	badLimits := []string{"0", "25", "abc", "-5"}
	for _, bl := range badLimits {
		rec = f.do(http.MethodGet, "/v1/users?q=al&limit="+bl, "", nil, caller)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for limit=%s, got %d", bl, rec.Code)
		}
	}

	// 8. Query length limit (> 100 characters)
	longQ := strings.Repeat("a", 101)
	rec = f.do(http.MethodGet, "/v1/users?q="+longQ, "", nil, caller)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for 101-char query, got %d", rec.Code)
	}
}

func TestProfileRoutesSearchRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	sender := &memSender{}
	svc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	limiter := NewSearchLimiter(3, time.Minute)

	h := NewRouter(Deps{
		Log:           slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)),
		Health:        health.New(pool, time.Second, slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))),
		Auth:          svc,
		Profiles:      profile.NewRepo(pool),
		Security:      Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
		SearchLimiter: limiter,
	})
	f := authFixture{pool: pool, h: h, mail: sender, auth: svc}

	cookie := f.signIn(t, "ratelimit-search@example.test")

	// 3 requests allowed under limit
	for i := 1; i <= 3; i++ {
		rec := f.do(http.MethodGet, "/v1/users?q=test", "", nil, cookie)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d should succeed, got %d", i, rec.Code)
		}
	}

	// 4th request must be rejected with 429 and Retry-After header
	rec := f.do(http.MethodGet, "/v1/users?q=test", "", nil, cookie)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request: %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("429 response missing Retry-After header")
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("content type = %q, want problem+json", rec.Header().Get("Content-Type"))
	}
}

func TestProfileRoutesSearchConcurrentRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	sender := &memSender{}
	svc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	const limit = 5
	const total = 15
	limiter := NewSearchLimiter(limit, time.Minute)

	h := NewRouter(Deps{
		Log:           slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)),
		Health:        health.New(pool, time.Second, slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))),
		Auth:          svc,
		Profiles:      profile.NewRepo(pool),
		Security:      Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
		SearchLimiter: limiter,
	})
	f := authFixture{pool: pool, h: h, mail: sender, auth: svc}
	cookie := f.signIn(t, "concurrent-ratelimit@example.test")

	var wg sync.WaitGroup
	start := make(chan struct{})
	var okCount atomic.Int32
	var rateLimitedCount atomic.Int32

	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			rec := f.do(http.MethodGet, "/v1/users?q=test", "", nil, cookie)
			if rec.Code == http.StatusOK {
				okCount.Add(1)
			} else if rec.Code == http.StatusTooManyRequests {
				rateLimitedCount.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if okCount.Load() != limit {
		t.Fatalf("expected exactly %d requests to succeed, got %d", limit, okCount.Load())
	}
	if rateLimitedCount.Load() != total-limit {
		t.Fatalf("expected exactly %d requests to be 429, got %d", total-limit, rateLimitedCount.Load())
	}
}

func TestProfileRoutesFollowSecurityAndWorkflow(t *testing.T) {
	f := newAuthFixture(t)

	// Setup Alice
	aliceCookie := f.signIn(t, "alice-follow-route@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": aliceCSRF,
	}
	patchAlice := f.do(http.MethodPatch, "/v1/me", `{"username":"alice_route"}`, aliceHeaders, aliceCookie)
	if patchAlice.Code != http.StatusOK {
		t.Fatalf("setup alice username: %d %s", patchAlice.Code, patchAlice.Body.String())
	}

	// Setup Bob
	bobCookie := f.signIn(t, "bob-follow-route@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": bobCSRF,
	}
	patchBob := f.do(http.MethodPatch, "/v1/me", `{"username":"bob_route"}`, bobHeaders, bobCookie)
	if patchBob.Code != http.StatusOK {
		t.Fatalf("setup bob username: %d %s", patchBob.Code, patchBob.Body.String())
	}

	// 1. Unauthenticated requests fail closed with 401
	rec := f.do(http.MethodPost, "/v1/users/bob_route/follow", "", aliceHeaders, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST follow without session: %d, want 401", rec.Code)
	}
	rec = f.do(http.MethodDelete, "/v1/users/bob_route/follow", "", aliceHeaders, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("DELETE follow without session: %d, want 401", rec.Code)
	}

	// 2. Missing Origin fails with 403
	noOrigin := map[string]string{"Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}
	rec = f.do(http.MethodPost, "/v1/users/bob_route/follow", "", noOrigin, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST follow without origin: %d, want 403", rec.Code)
	}
	rec = f.do(http.MethodDelete, "/v1/users/bob_route/follow", "", noOrigin, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("DELETE follow without origin: %d, want 403", rec.Code)
	}

	// 3. Disallowed Origin fails with 403
	badOrigin := map[string]string{"Origin": "https://attacker.example", "Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}
	rec = f.do(http.MethodPost, "/v1/users/bob_route/follow", "", badOrigin, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST follow with bad origin: %d, want 403", rec.Code)
	}

	// 4. Missing or invalid CSRF fails with 403
	badCSRF := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": "invalid_csrf_token"}
	rec = f.do(http.MethodPost, "/v1/users/bob_route/follow", "", badCSRF, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST follow with bad CSRF: %d, want 403", rec.Code)
	}
	rec = f.do(http.MethodDelete, "/v1/users/bob_route/follow", "", badCSRF, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("DELETE follow with bad CSRF: %d, want 403", rec.Code)
	}

	// 5. Self-follow rejected with 400 Problem Details
	rec = f.do(http.MethodPost, "/v1/users/alice_route/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST self-follow: %d, want 400", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("self-follow content-type = %q, want problem+json", rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Body.String(), "You cannot follow yourself.") {
		t.Fatalf("self-follow body = %q, want 'You cannot follow yourself.'", rec.Body.String())
	}

	// 6. Nonexistent target rejected with 404 Problem Details
	rec = f.do(http.MethodPost, "/v1/users/nobody_exists_here/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST nonexistent user follow: %d, want 404", rec.Code)
	}
	rec = f.do(http.MethodDelete, "/v1/users/nobody_exists_here/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("DELETE nonexistent user unfollow: %d, want 404", rec.Code)
	}

	// 7. Valid follow succeeds with 204 No Content
	rec = f.do(http.MethodPost, "/v1/users/bob_route/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST follow valid: %d %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("204 response must have no body, got %q", rec.Body.String())
	}

	// 8. Repeated follow succeeds with 204 No Content (idempotent)
	rec = f.do(http.MethodPost, "/v1/users/bob_route/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST repeated follow: %d %s", rec.Code, rec.Body.String())
	}

	// 9. Case-insensitive unfollow succeeds with 204 No Content
	rec = f.do(http.MethodDelete, "/v1/users/BOB_ROUTE/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE follow case-insensitive: %d %s", rec.Code, rec.Body.String())
	}

	// 10. Repeated unfollow succeeds with 204 No Content (idempotent)
	rec = f.do(http.MethodDelete, "/v1/users/bob_route/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE repeated unfollow: %d %s", rec.Code, rec.Body.String())
	}
}

func TestProfileRoutesFollowRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	sender := &memSender{}
	svc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	limiter := NewSlidingLimiter(3, time.Minute)

	h := NewRouter(Deps{
		Log:           slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)),
		Health:        health.New(pool, time.Second, slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))),
		Auth:          svc,
		Profiles:      profile.NewRepo(pool),
		Security:      Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
		FollowLimiter: limiter,
	})
	f := authFixture{pool: pool, h: h, mail: sender, auth: svc}

	aliceCookie := f.signIn(t, "alice-ratelimit@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": aliceCSRF,
	}
	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_rl"}`, aliceHeaders, aliceCookie)

	bobCookie := f.signIn(t, "bob-ratelimit@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": bobCSRF,
	}
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_rl"}`, bobHeaders, bobCookie)

	// 3 requests allowed under limit
	for i := 1; i <= 3; i++ {
		rec := f.do(http.MethodPost, "/v1/users/bob_rl/follow", "", aliceHeaders, aliceCookie)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("request %d should succeed with 204, got %d", i, rec.Code)
		}
	}

	// 4th request must be rejected with 429 and Retry-After header
	rec := f.do(http.MethodPost, "/v1/users/bob_rl/follow", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request: %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("429 response missing Retry-After header")
	}
	if rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("content type = %q, want problem+json", rec.Header().Get("Content-Type"))
	}
	if !strings.Contains(rec.Body.String(), "Too many follow requests. Try again later.") {
		t.Fatalf("problem detail = %q, want 'Too many follow requests. Try again later.'", rec.Body.String())
	}
}

func TestProfileRoutesFollowConcurrentRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	sender := &memSender{}
	svc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	const limit = 5
	const total = 15
	limiter := NewSlidingLimiter(limit, time.Minute)

	h := NewRouter(Deps{
		Log:           slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil)),
		Health:        health.New(pool, time.Second, slog.New(slog.NewJSONHandler(&bytes.Buffer{}, nil))),
		Auth:          svc,
		Profiles:      profile.NewRepo(pool),
		Security:      Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
		FollowLimiter: limiter,
	})
	f := authFixture{pool: pool, h: h, mail: sender, auth: svc}

	aliceCookie := f.signIn(t, "concurrent-follow-rl@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": aliceCSRF,
	}
	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_c_rl"}`, aliceHeaders, aliceCookie)

	bobCookie := f.signIn(t, "bob-target-rl@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": bobCSRF,
	}
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_c_rl"}`, bobHeaders, bobCookie)

	var wg sync.WaitGroup
	start := make(chan struct{})
	var okCount atomic.Int32
	var rateLimitedCount atomic.Int32

	for i := 0; i < total; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			rec := f.do(http.MethodPost, "/v1/users/bob_c_rl/follow", "", aliceHeaders, aliceCookie)
			if rec.Code == http.StatusNoContent {
				okCount.Add(1)
			} else if rec.Code == http.StatusTooManyRequests {
				rateLimitedCount.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if okCount.Load() != limit {
		t.Fatalf("expected exactly %d requests to succeed, got %d", limit, okCount.Load())
	}
	if rateLimitedCount.Load() != total-limit {
		t.Fatalf("expected exactly %d requests to be 429, got %d", total-limit, rateLimitedCount.Load())
	}
}
