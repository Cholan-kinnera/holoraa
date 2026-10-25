package httpapi

import (
	"context"
	"errors"
	"math"
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
)

// Security holds the cookie and origin settings the auth routes need.
type Security struct {
	CookieName     string
	CookieSecure   bool
	AllowedOrigins []string
}

// CSRFHeader carries the CSRF token on state-changing, session-authenticated requests.
const CSRFHeader = "X-CSRF-Token"

type sessionCtxKey struct{}

// sessionFrom returns the session attached by requireSession.
func sessionFrom(ctx context.Context) (auth.Session, bool) {
	s, ok := ctx.Value(sessionCtxKey{}).(auth.Session)
	return s, ok
}

// originCheck rejects state-changing requests whose Origin is missing or not
// on the allowlist. This is the first CSRF control (ADR 0009).
func (d Deps) originCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || !slices.Contains(d.Security.AllowedOrigins, origin) {
			d.writeProblem(w, r, http.StatusForbidden, "The request origin is not allowed.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireSession resolves the session cookie. Any failure is 401, with no
// detail about why.
func (d Deps) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(d.Security.CookieName)
		if err != nil {
			d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		sess, err := d.Auth.ValidateSession(r.Context(), cookie.Value)
		if err != nil {
			if !errors.Is(err, auth.ErrUnauthenticated) {
				d.Log.ErrorContext(r.Context(), "validate session", "error", err.Error())
			}
			d.clearSessionCookie(w)
			d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionCtxKey{}, sess)))
	})
}

// requireCSRF checks the X-CSRF-Token header against the session. It runs after requireSession.
func (d Deps) requireCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, ok := sessionFrom(r.Context())
		if !ok || !d.Auth.ValidCSRF(sess.ID, r.Header.Get(CSRFHeader)) {
			d.writeProblem(w, r, http.StatusForbidden, "The CSRF token is missing or invalid.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// registerAuthRoutes adds the sign-in and session endpoints under /v1.
func (d Deps) registerAuthRoutes(v1 chi.Router) {
	origin := d.originCheck
	session := d.requireSession
	csrf := d.requireCSRF

	v1.With(origin).Post("/auth/otp", d.sendCode)
	v1.With(origin).Post("/auth/otp/verify", d.verifyCode)
	v1.With(session).Get("/auth/session", d.currentSession)
	v1.With(origin, session, csrf).Post("/auth/logout", d.logout)
}

type sendCodeRequest struct {
	Email string `json:"email"`
}

type sendCodeResponse struct {
	ChallengeID string `json:"challengeId"`
}

func (d Deps) sendCode(w http.ResponseWriter, r *http.Request) {
	var body sendCodeRequest
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}
	id, err := d.Auth.SendCode(r.Context(), body.Email, clientIP(r))
	if err != nil {
		d.authProblem(w, r, err, "send code")
		return
	}
	writeJSON(w, r, http.StatusAccepted, sendCodeResponse{ChallengeID: id})
}

type verifyRequest struct {
	ChallengeID string `json:"challengeId"`
	Code        string `json:"code"`
}

type verifyResponse struct {
	User userBody `json:"user"`
}

func (d Deps) verifyCode(w http.ResponseWriter, r *http.Request) {
	var body verifyRequest
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}
	// A presented session is rotated: sign-in always issues a new one.
	presented := ""
	if c, err := r.Cookie(d.Security.CookieName); err == nil {
		presented = c.Value
	}
	res, err := d.Auth.VerifyCode(r.Context(), body.ChallengeID, body.Code, clientIP(r), presented)
	if err != nil {
		d.authProblem(w, r, err, "verify code")
		return
	}
	d.setSessionCookie(w, res.Token)

	me, err := d.Profiles.Me(r.Context(), res.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "read profile after sign-in", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}
	writeJSON(w, r, http.StatusOK, verifyResponse{User: toUserBody(me)})
}

type currentSessionResponse struct {
	User      userBody `json:"user"`
	CSRFToken string   `json:"csrfToken"`
}

func (d Deps) currentSession(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	me, err := d.Profiles.Me(r.Context(), sess.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "read profile for session", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}
	writeJSON(w, r, http.StatusOK, currentSessionResponse{
		User:      toUserBody(me),
		CSRFToken: d.Auth.CSRFToken(sess.ID),
	})
}

func (d Deps) logout(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	if err := d.Auth.RevokeSession(r.Context(), sess.ID); err != nil {
		d.Log.ErrorContext(r.Context(), "revoke session", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}
	d.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// authProblem maps a service error to one generic response. Unknown errors are
// logged without their text reaching the client.
func (d Deps) authProblem(w http.ResponseWriter, r *http.Request, err error, op string) {
	var rl *auth.RateLimitError
	switch {
	case errors.Is(err, auth.ErrMalformed):
		d.writeProblem(w, r, http.StatusBadRequest, "The request is not valid.")
	case errors.Is(err, auth.ErrInvalidCode):
		d.writeProblem(w, r, http.StatusUnauthorized, "The code is invalid or has expired.")
	case errors.Is(err, auth.ErrSendFailed):
		d.writeProblem(w, r, http.StatusServiceUnavailable, "The code could not be sent. Try again shortly.")
	case errors.As(err, &rl):
		setRetryAfter(w, int64(math.Ceil(rl.RetryAfter.Seconds())))
		d.writeProblem(w, r, http.StatusTooManyRequests, "Too many requests. Try again later.")
	default:
		d.Log.ErrorContext(r.Context(), op+" failed", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
	}
}

// writeDecodeProblem answers a body that could not be read.
func (d Deps) writeDecodeProblem(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, errUnsupportedMedia) {
		d.writeProblem(w, r, http.StatusUnsupportedMediaType, "The request must be JSON (application/json).")
		return
	}
	d.writeProblem(w, r, http.StatusBadRequest, "The request body is not valid for this endpoint.")
}

// writeProblem and the cookie helpers keep routing code short.
func (d Deps) writeProblem(w http.ResponseWriter, r *http.Request, status int, detail string) {
	writeProblem(w, r, d.Log, status, detail)
}

func (d Deps) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     d.Security.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   d.Security.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(auth.SessionAbsoluteTTL.Seconds()),
	})
}

func (d Deps) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     d.Security.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   d.Security.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// userBody is the caller's own profile as sent to clients.
type userBody struct {
	ID              string  `json:"id"`
	Email           string  `json:"email"`
	Username        *string `json:"username"`
	DisplayName     *string `json:"displayName"`
	Bio             *string `json:"bio"`
	AvatarURL       *string `json:"avatarUrl"`
	ProfileComplete bool    `json:"profileComplete"`
}

func toUserBody(m profile.Me) userBody {
	return userBody{
		ID:              m.ID,
		Email:           m.Email,
		Username:        m.Username,
		DisplayName:     m.DisplayName,
		Bio:             m.Bio,
		AvatarURL:       m.AvatarURL,
		ProfileComplete: m.Complete(),
	}
}
