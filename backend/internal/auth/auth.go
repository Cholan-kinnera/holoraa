// Package auth implements email one-time codes, server-side sessions, and the
// CSRF token derived from a session. The design is in
// docs/architecture/AUTH_AND_PROFILES.md and the decision in ADR 0009.
//
// Secrets: a code is stored only as HMAC(secret, challenge ID and code). A
// session token is stored only as SHA-256 of the token. Client addresses and
// emails in rate-limit events are stored as HMACs. Nothing secret is logged.
//
// Concurrency: transactions take advisory locks in one fixed order (email
// first, then client address), so concurrent requests cannot deadlock. Rate
// limits are counted in PostgreSQL, so they hold across API processes.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/mail"
)

// Limits and lifetimes. Owner-approved values come from ADR 0009. The two IP
// limits are proposed defaults (decision D11).
const (
	CodeLifetime             = 10 * time.Minute
	MaxWrongAttempts         = 5
	SendCooldown             = 60 * time.Second
	MaxSendsPerEmailPerHour  = 5
	MaxSendsPerIPPerHour     = 20
	MaxFailuresPerIPPer15Min = 30
	SessionIdleTTL           = 14 * 24 * time.Hour
	SessionAbsoluteTTL       = 30 * 24 * time.Hour

	// touchInterval limits how often a valid request writes last_seen_at.
	touchInterval = 5 * time.Minute

	// Retention for rows that are no longer needed (decision D11 proposes these).
	challengeRetention = 24 * time.Hour
	eventRetention     = 48 * time.Hour
	sessionRetention   = 30 * 24 * time.Hour
)

// Sentinel errors. Handlers map them to Problem Details. Messages never say
// whether an account exists.
var (
	// ErrMalformed means the input does not have the expected shape.
	ErrMalformed = errors.New("malformed input")
	// ErrInvalidCode is the one generic failure for wrong, expired, consumed,
	// and locked challenges, and for unknown challenge IDs.
	ErrInvalidCode = errors.New("invalid code")
	// ErrUnauthenticated means there is no valid session.
	ErrUnauthenticated = errors.New("unauthenticated")
	// ErrSendFailed means the code could not be delivered. Nothing is recorded.
	ErrSendFailed = errors.New("could not send the code")
)

// RateLimitError reports that a limit was reached. It depends only on the email
// string or the client address, never on whether an account exists.
type RateLimitError struct {
	RetryAfter time.Duration
}

func (e *RateLimitError) Error() string { return "rate limited" }

// Service runs the sign-in and session operations.
type Service struct {
	pool   *pgxpool.Pool
	secret []byte
	mail   mail.Sender
	rnd    io.Reader
}

// New returns a Service. secret must be at least 32 bytes (checked by config).
// rnd supplies randomness; production passes crypto/rand.Reader.
func New(pool *pgxpool.Pool, secret []byte, sender mail.Sender, rnd io.Reader) *Service {
	return &Service{pool: pool, secret: secret, mail: sender, rnd: rnd}
}

// SendCode creates a challenge and emails the code. It returns the challenge
// ID. The result is the same for known and unknown emails.
func (s *Service) SendCode(ctx context.Context, rawEmail, clientIP string) (string, error) {
	email, err := NormalizeEmail(rawEmail)
	if err != nil {
		return "", err
	}
	challengeID, err := newUUID(s.rnd)
	if err != nil {
		return "", fmt.Errorf("new challenge id: %w", err)
	}
	code, err := randomCode(s.rnd)
	if err != nil {
		return "", fmt.Errorf("new code: %w", err)
	}
	emailKey := s.mac("email", email)
	ipKey := s.mac("ip", clientIP)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Email first, then client address: the order every transaction uses.
	if err := lock(ctx, tx, "otp-send-email:"+hex.EncodeToString(emailKey)); err != nil {
		return "", err
	}
	if err := lock(ctx, tx, "otp-send-ip:"+hex.EncodeToString(ipKey)); err != nil {
		return "", err
	}
	if err := purge(ctx, tx); err != nil {
		return "", err
	}
	if err := s.checkSendLimits(ctx, tx, emailKey, ipKey); err != nil {
		return "", err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO email_otp_challenges (id, email, code_mac, expires_at, ip_hash)
		 VALUES ($1, $2, $3, now() + make_interval(secs => $4), $5)`,
		challengeID, email, s.codeMAC(challengeID, code), CodeLifetime.Seconds(), ipKey); err != nil {
		return "", fmt.Errorf("insert challenge: %w", err)
	}

	// Delivery happens before commit. If it fails, nothing is recorded and the
	// caller can retry without using up a send.
	msg := mail.Message{
		To:      email,
		Subject: "Your Holoraa sign-in code",
		Text: fmt.Sprintf("Your Holoraa sign-in code is %s.\n\n"+
			"It expires in %d minutes. If you did not ask for it, you can ignore this email.\n",
			code, int(CodeLifetime.Minutes())),
	}
	if err := s.mail.Send(ctx, msg); err != nil {
		// The provider error is not returned: it can name the provider and status.
		return "", ErrSendFailed
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO auth_events (kind, ip_hash, email_hash) VALUES ('otp_sent', $1, $2)`,
		ipKey, emailKey); err != nil {
		return "", fmt.Errorf("record send: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit send: %w", err)
	}
	return challengeID, nil
}

// checkSendLimits applies the cooldown and the hourly limits for the email and
// for the client address. It returns a RateLimitError when one is reached.
func (s *Service) checkSendLimits(ctx context.Context, tx pgx.Tx, emailKey, ipKey []byte) error {
	var cooldown int
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(CEIL(EXTRACT(EPOCH FROM (max(created_at) + make_interval(secs => $2) - now()))), 0)::int
		   FROM auth_events
		  WHERE kind = 'otp_sent' AND email_hash = $1 AND created_at > now() - make_interval(secs => $2)`,
		emailKey, SendCooldown.Seconds()).Scan(&cooldown); err != nil {
		return fmt.Errorf("check cooldown: %w", err)
	}
	if cooldown > 0 {
		return &RateLimitError{RetryAfter: time.Duration(cooldown) * time.Second}
	}

	if err := s.checkHourly(ctx, tx,
		`SELECT count(*), COALESCE(CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now()))), 0)::int
		   FROM auth_events
		  WHERE kind = 'otp_sent' AND email_hash = $1 AND created_at > now() - interval '1 hour'`,
		emailKey, MaxSendsPerEmailPerHour); err != nil {
		return err
	}
	return s.checkHourly(ctx, tx,
		`SELECT count(*), COALESCE(CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now()))), 0)::int
		   FROM auth_events
		  WHERE kind = 'otp_sent' AND ip_hash = $1 AND created_at > now() - interval '1 hour'`,
		ipKey, MaxSendsPerIPPerHour)
}

// checkHourly runs a count query and returns a RateLimitError at or above limit.
func (s *Service) checkHourly(ctx context.Context, tx pgx.Tx, query string, key []byte, limit int) error {
	var count, retry int
	if err := tx.QueryRow(ctx, query, key).Scan(&count, &retry); err != nil {
		return fmt.Errorf("count sends: %w", err)
	}
	if count >= limit {
		return &RateLimitError{RetryAfter: maxDuration(time.Duration(retry)*time.Second, time.Second)}
	}
	return nil
}

// VerifyResult is returned after a successful sign-in.
type VerifyResult struct {
	UserID string
	Token  string // the raw session token; only its hash is stored
}

// VerifyCode checks a code and, on success, signs the user in. presentedToken
// is the session token the request carried, if any. It is revoked (rotation).
func (s *Service) VerifyCode(ctx context.Context, challengeID, code, clientIP, presentedToken string) (VerifyResult, error) {
	if !validUUID(challengeID) || !validCode(code) {
		return VerifyResult{}, ErrMalformed
	}
	ipKey := s.mac("ip", clientIP)

	// Read the failure count before taking any lock. The limit is a soft bound
	// under concurrency, and taking no lock here keeps lock order consistent.
	var failures, retry int
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*), COALESCE(CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '15 minutes' - now()))), 0)::int
		   FROM auth_events
		  WHERE kind = 'verify_failed' AND ip_hash = $1 AND created_at > now() - interval '15 minutes'`,
		ipKey).Scan(&failures, &retry); err != nil {
		return VerifyResult{}, fmt.Errorf("count failures: %w", err)
	}
	if failures >= MaxFailuresPerIPPer15Min {
		return VerifyResult{}, &RateLimitError{RetryAfter: maxDuration(time.Duration(retry)*time.Second, time.Second)}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return VerifyResult{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var email string
	var codeMAC []byte
	var attempts int16
	var expired, consumed bool
	err = tx.QueryRow(ctx,
		`SELECT email, code_mac, attempts, expires_at <= now(), consumed_at IS NOT NULL
		   FROM email_otp_challenges WHERE id = $1 FOR UPDATE`,
		challengeID).Scan(&email, &codeMAC, &attempts, &expired, &consumed)
	if errors.Is(err, pgx.ErrNoRows) {
		return VerifyResult{}, s.failAndCommit(ctx, tx, ipKey)
	}
	if err != nil {
		return VerifyResult{}, fmt.Errorf("read challenge: %w", err)
	}

	if consumed || expired || attempts >= MaxWrongAttempts {
		return VerifyResult{}, s.failAndCommit(ctx, tx, ipKey)
	}
	if !hmac.Equal(codeMAC, s.codeMAC(challengeID, code)) {
		if _, err := tx.Exec(ctx,
			`UPDATE email_otp_challenges SET attempts = attempts + 1 WHERE id = $1`, challengeID); err != nil {
			return VerifyResult{}, fmt.Errorf("count attempt: %w", err)
		}
		return VerifyResult{}, s.failAndCommit(ctx, tx, ipKey)
	}

	// Success. Lock the email so two sign-ins for a new address cannot both create
	// an account.
	emailKey := s.mac("email", email)
	if err := lock(ctx, tx, "otp-send-email:"+hex.EncodeToString(emailKey)); err != nil {
		return VerifyResult{}, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE email_otp_challenges SET consumed_at = now() WHERE id = $1`, challengeID); err != nil {
		return VerifyResult{}, fmt.Errorf("consume challenge: %w", err)
	}

	userID, err := findOrCreateUser(ctx, tx, email)
	if err != nil {
		return VerifyResult{}, err
	}

	if presentedToken != "" {
		if _, err := tx.Exec(ctx,
			`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
			tokenHash(presentedToken)); err != nil {
			return VerifyResult{}, fmt.Errorf("rotate session: %w", err)
		}
	}

	token, err := newToken(s.rnd)
	if err != nil {
		return VerifyResult{}, fmt.Errorf("new token: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
		 VALUES ($1, $2, now() + make_interval(secs => $3), now() + make_interval(secs => $4))`,
		userID, tokenHash(token), SessionIdleTTL.Seconds(), SessionAbsoluteTTL.Seconds()); err != nil {
		return VerifyResult{}, fmt.Errorf("insert session: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return VerifyResult{}, fmt.Errorf("commit sign-in: %w", err)
	}
	return VerifyResult{UserID: userID, Token: token}, nil
}

// failAndCommit records a failed verification for the client address and
// commits, so the failure counts even though the request is rejected.
func (s *Service) failAndCommit(ctx context.Context, tx pgx.Tx, ipKey []byte) error {
	if _, err := tx.Exec(ctx,
		`INSERT INTO auth_events (kind, ip_hash) VALUES ('verify_failed', $1)`, ipKey); err != nil {
		return fmt.Errorf("record failure: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit failure: %w", err)
	}
	return ErrInvalidCode
}

// Session identifies an authenticated request.
type Session struct {
	ID     string
	UserID string
}

// ValidateSession returns the session for a raw token, or ErrUnauthenticated.
// It refreshes the idle expiry at most once per touchInterval.
func (s *Service) ValidateSession(ctx context.Context, token string) (Session, error) {
	if token == "" {
		return Session{}, ErrUnauthenticated
	}
	var sess Session
	var needTouch bool
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, user_id::text, last_seen_at < now() - make_interval(secs => $2)
		   FROM sessions
		  WHERE token_hash = $1 AND revoked_at IS NULL
		    AND now() < idle_expires_at AND now() < absolute_expires_at`,
		tokenHash(token), touchInterval.Seconds()).Scan(&sess.ID, &sess.UserID, &needTouch)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrUnauthenticated
	}
	if err != nil {
		return Session{}, fmt.Errorf("read session: %w", err)
	}
	if needTouch {
		if _, err := s.pool.Exec(ctx,
			`UPDATE sessions
			    SET last_seen_at = now(),
			        idle_expires_at = LEAST(now() + make_interval(secs => $2), absolute_expires_at)
			  WHERE id = $1`,
			sess.ID, SessionIdleTTL.Seconds()); err != nil {
			return Session{}, fmt.Errorf("refresh session: %w", err)
		}
	}
	return sess, nil
}

// RevokeSession ends one session. It is idempotent.
func (s *Service) RevokeSession(ctx context.Context, sessionID string) error {
	if _, err := s.pool.Exec(ctx,
		`UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, sessionID); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// CSRFToken returns the token a client must send with state-changing requests
// made under this session. It is an HMAC of the session ID.
func (s *Service) CSRFToken(sessionID string) string {
	return base64.RawURLEncoding.EncodeToString(s.mac("csrf", sessionID))
}

// ValidCSRF reports whether presented matches the session's token, in constant time.
func (s *Service) ValidCSRF(sessionID, presented string) bool {
	expected := s.CSRFToken(sessionID)
	return presented != "" && subtle.ConstantTimeCompare([]byte(expected), []byte(presented)) == 1
}

// codeMAC binds a code to its challenge, so a code cannot be reused across challenges.
func (s *Service) codeMAC(challengeID, code string) []byte {
	return s.mac("otp", challengeID, code)
}

// mac is HMAC-SHA256 over a label and parts. Parts are NUL-separated so that
// different splits of the same bytes give different results.
func (s *Service) mac(label string, parts ...string) []byte {
	h := hmac.New(sha256.New, s.secret)
	h.Write([]byte(label))
	for _, p := range parts {
		h.Write([]byte{0})
		h.Write([]byte(p))
	}
	return h.Sum(nil)
}

func tokenHash(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func lock(ctx context.Context, tx pgx.Tx, key string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, key); err != nil {
		return fmt.Errorf("lock: %w", err)
	}
	return nil
}

// purge removes rows past their retention. It runs inside the send transaction,
// so it is bounded by sends. A dedicated job can replace it later (D11).
func purge(ctx context.Context, tx pgx.Tx) error {
	for _, q := range []struct {
		sql  string
		keep time.Duration
	}{
		{`DELETE FROM email_otp_challenges WHERE expires_at < now() - make_interval(secs => $1)`, challengeRetention},
		{`DELETE FROM auth_events WHERE created_at < now() - make_interval(secs => $1)`, eventRetention},
		{`DELETE FROM sessions WHERE absolute_expires_at < now() - make_interval(secs => $1)`, sessionRetention},
	} {
		if _, err := tx.Exec(ctx, q.sql, q.keep.Seconds()); err != nil {
			return fmt.Errorf("purge: %w", err)
		}
	}
	return nil
}

func findOrCreateUser(ctx context.Context, tx pgx.Tx, email string) (string, error) {
	var userID string
	err := tx.QueryRow(ctx,
		`SELECT user_id::text FROM email_identities WHERE email = $1`, email).Scan(&userID)
	if err == nil {
		return userID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("find identity: %w", err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO users DEFAULT VALUES RETURNING id::text`).Scan(&userID); err != nil {
		return "", fmt.Errorf("create user: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO email_identities (email, user_id) VALUES ($1, $2)`, email, userID); err != nil {
		return "", fmt.Errorf("create identity: %w", err)
	}
	return userID, nil
}

func maxDuration(a, b time.Duration) time.Duration {
	if a > b {
		return a
	}
	return b
}
