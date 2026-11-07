package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/mail"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// captureSender records messages in memory instead of delivering them.
type captureSender struct {
	mu   sync.Mutex
	msgs []mail.Message
	fail bool
}

func (c *captureSender) Send(_ context.Context, m mail.Message) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fail {
		return errors.New("provider unavailable")
	}
	c.msgs = append(c.msgs, m)
	return nil
}

func (c *captureSender) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.msgs)
}

var codeInMail = regexp.MustCompile(`code is ([0-9]{6})\.`)

// lastCode returns the six-digit code from the most recent message.
func (c *captureSender) lastCode(t *testing.T) string {
	t.Helper()
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.msgs) == 0 {
		t.Fatal("no message was sent")
	}
	m := codeInMail.FindStringSubmatch(c.msgs[len(c.msgs)-1].Text)
	if m == nil {
		t.Fatal("message does not contain a code")
	}
	return m[1]
}

const testSecret = "test-only-auth-secret-0123456789abcdef-placeholder"

func newTestService(t *testing.T) (*Service, *pgxpool.Pool, *captureSender) {
	t.Helper()
	pool := testdb.Pool(t)
	sender := &captureSender{}
	return New(pool, []byte(testSecret), sender, rand.Reader), pool, sender
}

// sendAndCode sends a code to email and returns the challenge ID and the code.
// Previous sends for the same email are aged so the cooldown does not apply.
func sendAndCode(t *testing.T, s *Service, sender *captureSender, pool *pgxpool.Pool, email, ip string) (string, string) {
	t.Helper()
	id, err := s.SendCode(context.Background(), email, ip)
	if err != nil {
		t.Fatalf("SendCode: %v", err)
	}
	return id, sender.lastCode(t)
}

// ageSends moves every recorded send back in time, so tests can send again
// without waiting for the cooldown.
func ageSends(t *testing.T, pool *pgxpool.Pool, d time.Duration) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE auth_events SET created_at = created_at - make_interval(secs => $1) WHERE kind = 'otp_sent'`,
		d.Seconds()); err != nil {
		t.Fatalf("age sends: %v", err)
	}
}

func TestSendCodeStoresOnlyAKeyedMAC(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "person@example.test", "192.0.2.10")

	var stored []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT code_mac FROM email_otp_challenges WHERE id = $1`, id).Scan(&stored); err != nil {
		t.Fatalf("read challenge: %v", err)
	}
	if len(stored) != 32 {
		t.Fatalf("code_mac length = %d, want 32", len(stored))
	}
	if string(stored) == code {
		t.Fatal("the code itself is stored")
	}
	plainDigest := sha256.Sum256([]byte(code))
	if string(stored) == string(plainDigest[:]) {
		t.Fatal("an unkeyed digest of the code is stored")
	}
}

func TestVerifyCodeSignsInOnceAndRejectsReplay(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "once@example.test", "192.0.2.11")

	res, err := s.VerifyCode(context.Background(), id, code, "192.0.2.11", "")
	if err != nil {
		t.Fatalf("first verify: %v", err)
	}
	if res.UserID == "" || res.Token == "" {
		t.Fatal("first verify returned no user or token")
	}

	if _, err := s.VerifyCode(context.Background(), id, code, "192.0.2.11", ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("replay error = %v, want ErrInvalidCode", err)
	}
}

func TestWrongCodeLocksTheChallengeAfterFiveAttempts(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "lock@example.test", "192.0.2.12")

	wrong := "000000"
	if code == wrong {
		wrong = "111111"
	}
	for i := 0; i < MaxWrongAttempts; i++ {
		if _, err := s.VerifyCode(context.Background(), id, wrong, "192.0.2.12", ""); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("wrong attempt %d: %v, want ErrInvalidCode", i+1, err)
		}
	}
	// Even the right code is refused once the challenge is locked.
	if _, err := s.VerifyCode(context.Background(), id, code, "192.0.2.12", ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("correct code after lockout: %v, want ErrInvalidCode", err)
	}
}

func TestExpiredChallengeIsRejected(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "old@example.test", "192.0.2.13")

	if _, err := pool.Exec(context.Background(),
		`UPDATE email_otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, id); err != nil {
		t.Fatalf("expire challenge: %v", err)
	}
	if _, err := s.VerifyCode(context.Background(), id, code, "192.0.2.13", ""); !errors.Is(err, ErrInvalidCode) {
		t.Fatalf("expired verify: %v, want ErrInvalidCode", err)
	}
}

func TestResendCooldownAppliesPerEmail(t *testing.T) {
	s, pool, sender := newTestService(t)
	sendAndCode(t, s, sender, pool, "cool@example.test", "192.0.2.14")

	_, err := s.SendCode(context.Background(), "cool@example.test", "192.0.2.15")
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("second send error = %v, want RateLimitError", err)
	}
	if rl.RetryAfter <= 0 || rl.RetryAfter > SendCooldown {
		t.Fatalf("RetryAfter = %v, want within the cooldown", rl.RetryAfter)
	}
	if sender.count() != 1 {
		t.Fatalf("messages sent = %d, want 1", sender.count())
	}
}

func TestHourlyLimitPerEmail(t *testing.T) {
	s, pool, sender := newTestService(t)
	for i := 0; i < MaxSendsPerEmailPerHour; i++ {
		if _, err := s.SendCode(context.Background(), "hourly@example.test", "192.0.2.16"); err != nil {
			t.Fatalf("send %d: %v", i+1, err)
		}
		ageSends(t, pool, 2*time.Minute)
	}
	_, err := s.SendCode(context.Background(), "hourly@example.test", "192.0.2.16")
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("send beyond hourly limit: %v, want RateLimitError", err)
	}
	if sender.count() != MaxSendsPerEmailPerHour {
		t.Fatalf("messages sent = %d, want %d", sender.count(), MaxSendsPerEmailPerHour)
	}
}

func TestHourlyLimitPerClientAddress(t *testing.T) {
	s, _, _ := newTestService(t)
	const ip = "192.0.2.20"
	for i := 0; i < MaxSendsPerIPPerHour; i++ {
		email := "ip-user-" + string(rune('a'+i)) + "@example.test"
		if _, err := s.SendCode(context.Background(), email, ip); err != nil {
			t.Fatalf("send %d from one address: %v", i+1, err)
		}
	}
	_, err := s.SendCode(context.Background(), "ip-extra@example.test", ip)
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("send beyond per-address limit: %v, want RateLimitError", err)
	}
	// A different address is not affected.
	if _, err := s.SendCode(context.Background(), "ip-other@example.test", "192.0.2.21"); err != nil {
		t.Fatalf("send from another address: %v", err)
	}
}

func TestFailedVerificationsLimitPerClientAddress(t *testing.T) {
	s, _, _ := newTestService(t)
	const ip = "192.0.2.30"
	for i := 0; i < MaxFailuresPerIPPer15Min; i++ {
		// A random challenge ID that does not exist is a failure like any other.
		id, err := newUUID(rand.Reader)
		if err != nil {
			t.Fatalf("new id: %v", err)
		}
		if _, err := s.VerifyCode(context.Background(), id, "123456", ip, ""); !errors.Is(err, ErrInvalidCode) {
			t.Fatalf("failure %d: %v, want ErrInvalidCode", i+1, err)
		}
	}
	id, _ := newUUID(rand.Reader)
	_, err := s.VerifyCode(context.Background(), id, "123456", ip, "")
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatalf("verify beyond failure limit: %v, want RateLimitError", err)
	}
}

func TestSendFailureRecordsNothing(t *testing.T) {
	s, pool, sender := newTestService(t)
	sender.fail = true

	_, err := s.SendCode(context.Background(), "undelivered@example.test", "192.0.2.40")
	if !errors.Is(err, ErrSendFailed) {
		t.Fatalf("error = %v, want ErrSendFailed", err)
	}
	var challenges, events int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM email_otp_challenges`).Scan(&challenges); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM auth_events`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if challenges != 0 || events != 0 {
		t.Fatalf("rows after failed send: challenges=%d events=%d, want 0 and 0", challenges, events)
	}
}

func TestMalformedInputsAreRejectedBeforeAnyWrite(t *testing.T) {
	s, pool, _ := newTestService(t)
	ctx := context.Background()

	for _, email := range []string{"", "no-at-sign", "two@@example.test", "space in@example.test", "a@nodot", "a@.example.test", "a@example..test"} {
		if _, err := s.SendCode(ctx, email, "192.0.2.50"); !errors.Is(err, ErrMalformed) {
			t.Fatalf("SendCode(%q) = %v, want ErrMalformed", email, err)
		}
	}
	if _, err := s.VerifyCode(ctx, "not-a-uuid", "123456", "192.0.2.50", ""); !errors.Is(err, ErrMalformed) {
		t.Fatalf("bad challenge id: %v, want ErrMalformed", err)
	}
	id, _ := newUUID(rand.Reader)
	for _, code := range []string{"12345", "1234567", "12345a", " 123456"} {
		if _, err := s.VerifyCode(ctx, id, code, "192.0.2.50", ""); !errors.Is(err, ErrMalformed) {
			t.Fatalf("code %q: %v, want ErrMalformed", code, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM auth_events`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("malformed input recorded %d events, want 0", n)
	}
}

func TestSessionIsStoredAsAHashAndValidates(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "session@example.test", "192.0.2.60")
	res, err := s.VerifyCode(context.Background(), id, code, "192.0.2.60", "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}

	digest := sha256.Sum256([]byte(res.Token))
	var matches int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sessions WHERE token_hash = $1`, digest[:]).Scan(&matches); err != nil {
		t.Fatal(err)
	}
	if matches != 1 {
		t.Fatalf("sessions with the token's hash = %d, want 1", matches)
	}
	var raw int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sessions s WHERE s::text LIKE '%' || $1 || '%'`, res.Token).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if raw != 0 {
		t.Fatal("the raw session token is stored in the sessions table")
	}

	sess, err := s.ValidateSession(context.Background(), res.Token)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}
	if sess.UserID != res.UserID {
		t.Fatalf("session user = %q, want %q", sess.UserID, res.UserID)
	}
}

func TestSessionExpiresWhenIdleOrAbsolute(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "expire@example.test", "192.0.2.61")
	res, err := s.VerifyCode(context.Background(), id, code, "192.0.2.61", "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}

	if _, err := pool.Exec(context.Background(),
		`UPDATE sessions SET idle_expires_at = now() - interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ValidateSession(context.Background(), res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("idle-expired session: %v, want ErrUnauthenticated", err)
	}

	// Idle expiry must not be later than absolute expiry (a table constraint),
	// so both move into the past together.
	if _, err := pool.Exec(context.Background(),
		`UPDATE sessions SET idle_expires_at = now() - interval '2 seconds', absolute_expires_at = now() - interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ValidateSession(context.Background(), res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("absolute-expired session: %v, want ErrUnauthenticated", err)
	}
}

func TestSignInRotatesThePresentedSession(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "rotate@example.test", "192.0.2.62")
	first, err := s.VerifyCode(context.Background(), id, code, "192.0.2.62", "")
	if err != nil {
		t.Fatalf("first sign-in: %v", err)
	}

	ageSends(t, pool, 2*time.Minute)
	id2, code2 := sendAndCode(t, s, sender, pool, "rotate@example.test", "192.0.2.62")
	second, err := s.VerifyCode(context.Background(), id2, code2, "192.0.2.62", first.Token)
	if err != nil {
		t.Fatalf("second sign-in: %v", err)
	}
	if second.Token == first.Token {
		t.Fatal("sign-in reused the session token")
	}
	if _, err := s.ValidateSession(context.Background(), first.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("presented session after rotation: %v, want ErrUnauthenticated", err)
	}
	if _, err := s.ValidateSession(context.Background(), second.Token); err != nil {
		t.Fatalf("new session: %v", err)
	}
	if second.UserID != first.UserID {
		t.Fatal("the same email must map to the same user")
	}
}

func TestLogoutRevokesTheSession(t *testing.T) {
	s, pool, sender := newTestService(t)
	id, code := sendAndCode(t, s, sender, pool, "logout@example.test", "192.0.2.63")
	res, err := s.VerifyCode(context.Background(), id, code, "192.0.2.63", "")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	sess, err := s.ValidateSession(context.Background(), res.Token)
	if err != nil {
		t.Fatalf("ValidateSession: %v", err)
	}

	if err := s.RevokeSession(context.Background(), sess.ID); err != nil {
		t.Fatalf("RevokeSession: %v", err)
	}
	if err := s.RevokeSession(context.Background(), sess.ID); err != nil {
		t.Fatalf("second RevokeSession must be idempotent: %v", err)
	}
	if _, err := s.ValidateSession(context.Background(), res.Token); !errors.Is(err, ErrUnauthenticated) {
		t.Fatalf("revoked session: %v, want ErrUnauthenticated", err)
	}
}

func TestCSRFTokenIsBoundToTheSession(t *testing.T) {
	s, _, _ := newTestService(t)
	a := s.CSRFToken("11111111-1111-4111-8111-111111111111")
	b := s.CSRFToken("22222222-2222-4222-8222-222222222222")
	if a == b {
		t.Fatal("two sessions share a CSRF token")
	}
	if !s.ValidCSRF("11111111-1111-4111-8111-111111111111", a) {
		t.Fatal("the session's own token was rejected")
	}
	if s.ValidCSRF("22222222-2222-4222-8222-222222222222", a) {
		t.Fatal("a token from another session was accepted")
	}
	if s.ValidCSRF("11111111-1111-4111-8111-111111111111", "") {
		t.Fatal("an empty token was accepted")
	}
}

func TestSameEmailSignsInToTheSameUser(t *testing.T) {
	s, pool, sender := newTestService(t)
	id1, code1 := sendAndCode(t, s, sender, pool, "twice@example.test", "192.0.2.64")
	first, err := s.VerifyCode(context.Background(), id1, code1, "192.0.2.64", "")
	if err != nil {
		t.Fatal(err)
	}
	ageSends(t, pool, 2*time.Minute)
	id2, code2 := sendAndCode(t, s, sender, pool, "twice@example.test", "192.0.2.64")
	second, err := s.VerifyCode(context.Background(), id2, code2, "192.0.2.64", "")
	if err != nil {
		t.Fatal(err)
	}
	if first.UserID != second.UserID {
		t.Fatalf("user IDs differ: %q and %q", first.UserID, second.UserID)
	}
	var users int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("users = %d, want 1", users)
	}
}

func TestNormalizeEmailAcceptsAndRejects(t *testing.T) {
	ok := map[string]string{
		"  Person@Example.TEST ": "person@example.test",
		"a.b+c@sub.example.test": "a.b+c@sub.example.test",
	}
	for in, want := range ok {
		got, err := NormalizeEmail(in)
		if err != nil || got != want {
			t.Fatalf("NormalizeEmail(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{
		"", "x", "a@b", "a@@b.test", strings.Repeat("a", 65) + "@example.test",
		`"a b"@example.test`, `"a"@example.test`, "a,b@example.test", "<a>@example.test",
		"a(b)@example.test", "a@ex ample.test", "a@exa_mple.test", "a@.test", "a@example.t",
		"a@xn--p1ai", "a..b@example.test", ".a@example.test", "a\\b@example.test",
	} {
		if _, err := NormalizeEmail(in); !errors.Is(err, ErrMalformed) {
			t.Fatalf("NormalizeEmail(%q) = %v, want ErrMalformed", in, err)
		}
	}
}
