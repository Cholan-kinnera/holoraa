package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
)

// registerProfileRoutes adds the profile endpoints under /v1. Every route needs
// a session. Writes also need Origin and CSRF checks.
func (d Deps) registerProfileRoutes(v1 chi.Router) {
	v1.With(d.requireSession).Get("/me", d.getMe)
	v1.With(d.originCheck, d.requireSession, d.requireCSRF).Patch("/me", d.patchMe)
	v1.With(d.requireSession).Get("/users/{username}", d.getPublicProfile)
}

type meResponse struct {
	User userBody `json:"user"`
}

func (d Deps) getMe(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	me, err := d.Profiles.Me(r.Context(), sess.UserID)
	if err != nil {
		d.Log.ErrorContext(r.Context(), "read own profile", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
		return
	}
	writeJSON(w, r, http.StatusOK, meResponse{User: toUserBody(me)})
}

// patchBody lists the fields a caller may change. Unknown fields are rejected.
// A raw message distinguishes an absent field from an explicit null.
type patchBody struct {
	Username    json.RawMessage `json:"username"`
	DisplayName json.RawMessage `json:"displayName"`
	Bio         json.RawMessage `json:"bio"`
	AvatarURL   json.RawMessage `json:"avatarUrl"`
}

// toField converts one raw JSON value. Absent is not present, null clears, and
// anything else must be a string.
func toField(raw json.RawMessage) (profile.Field, bool) {
	if raw == nil {
		return profile.Field{}, true
	}
	if string(raw) == "null" {
		return profile.Field{Present: true, Null: true}, true
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return profile.Field{}, false
	}
	return profile.Field{Present: true, Value: s}, true
}

func (d Deps) patchMe(w http.ResponseWriter, r *http.Request) {
	sess, ok := sessionFrom(r.Context())
	if !ok {
		d.writeProblem(w, r, http.StatusUnauthorized, "Sign in to continue.")
		return
	}
	var body patchBody
	if err := decodeJSON(w, r, &body); err != nil {
		d.writeDecodeProblem(w, r, err)
		return
	}

	var patch profile.Patch
	var valid bool
	if patch.Username, valid = toField(body.Username); !valid {
		d.writeProblem(w, r, http.StatusBadRequest, "username must be a string or null.")
		return
	}
	if patch.DisplayName, valid = toField(body.DisplayName); !valid {
		d.writeProblem(w, r, http.StatusBadRequest, "displayName must be a string or null.")
		return
	}
	if patch.Bio, valid = toField(body.Bio); !valid {
		d.writeProblem(w, r, http.StatusBadRequest, "bio must be a string or null.")
		return
	}
	if patch.AvatarURL, valid = toField(body.AvatarURL); !valid {
		d.writeProblem(w, r, http.StatusBadRequest, "avatarUrl must be a string or null.")
		return
	}

	// The user ID comes from the verified session, never from the request.
	me, err := d.Profiles.Update(r.Context(), sess.UserID, patch)
	if err != nil {
		d.profileProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, meResponse{User: toUserBody(me)})
}

type publicProfileBody struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	AvatarURL   *string `json:"avatarUrl"`
}

func (d Deps) getPublicProfile(w http.ResponseWriter, r *http.Request) {
	p, err := d.Profiles.Public(r.Context(), chi.URLParam(r, "username"))
	if err != nil {
		d.profileProblem(w, r, err)
		return
	}
	writeJSON(w, r, http.StatusOK, publicProfileBody{
		ID:          p.ID,
		Username:    p.Username,
		DisplayName: p.DisplayName,
		Bio:         p.Bio,
		AvatarURL:   p.AvatarURL,
	})
}

// profileProblem maps profile errors to Problem Details. Validation details
// name the field and rule, never the submitted value.
func (d Deps) profileProblem(w http.ResponseWriter, r *http.Request, err error) {
	var ve *profile.ValidationError
	switch {
	case errors.As(err, &ve):
		d.writeProblem(w, r, http.StatusBadRequest, ve.Field+": "+ve.Reason+".")
	case errors.Is(err, profile.ErrUsernameTaken):
		d.writeProblem(w, r, http.StatusConflict, "That username is already taken.")
	case errors.Is(err, profile.ErrNotFound):
		d.writeProblem(w, r, http.StatusNotFound, "No profile has this username.")
	default:
		d.Log.ErrorContext(r.Context(), "profile request failed", "error", err.Error())
		d.writeProblem(w, r, http.StatusInternalServerError, "An internal error occurred.")
	}
}
