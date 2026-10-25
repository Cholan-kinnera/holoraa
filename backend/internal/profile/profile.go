// Package profile holds public and private profile data and its validation.
//
// Ownership: every write is keyed by the user ID of the verified session. The
// API never takes a user ID from the request body or path for a write.
// Public profiles never include the email address.
package profile

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Limits. They match the database check constraints in migration 00002.
const (
	usernameMin        = 3
	usernameMax        = 32
	displayNameMax     = 64
	bioMax             = 300
	avatarURLMax       = 2048
	usernameConstraint = "users_username_key"
)

var usernamePattern = regexp.MustCompile(`^[a-z][a-z0-9_]{2,31}$`)

// reserved names cannot be claimed, so they cannot be used to impersonate
// the product or its routes.
var reserved = map[string]bool{
	"admin": true, "api": true, "holoraa": true, "me": true,
	"root": true, "support": true, "users": true, "v1": true,
}

// Sentinel errors. Handlers map them to Problem Details.
var (
	// ErrUsernameTaken means another account already has the username.
	ErrUsernameTaken = errors.New("username taken")
	// ErrNotFound means no public profile has the username.
	ErrNotFound = errors.New("profile not found")
)

// ValidationError names the field and the rule it broke. The reason never
// echoes the value.
type ValidationError struct {
	Field  string
	Reason string
}

func (e *ValidationError) Error() string { return e.Field + ": " + e.Reason }

// Me is the caller's own profile. It includes the email address.
type Me struct {
	ID          string
	Email       string
	Username    *string
	DisplayName *string
	Bio         *string
	AvatarURL   *string
}

// Complete reports whether profile setup is finished (a username is set).
func (m Me) Complete() bool { return m.Username != nil }

// Public is the profile other users may see. It has no email address.
type Public struct {
	ID          string
	Username    string
	DisplayName *string
	Bio         *string
	AvatarURL   *string
}

// Field is one optional field of a partial update. Present is false when the
// request did not mention it. Null is true when the request set it to null.
type Field struct {
	Present bool
	Null    bool
	Value   string
}

// Patch is a partial update of the caller's profile.
type Patch struct {
	Username    Field
	DisplayName Field
	Bio         Field
	AvatarURL   Field
}

// ValidateUsername trims and lowercases the username, then checks the rules.
func ValidateUsername(raw string) (string, error) {
	u := strings.ToLower(strings.TrimSpace(raw))
	if n := utf8.RuneCountInString(u); n < usernameMin || n > usernameMax {
		return "", &ValidationError{Field: "username", Reason: "must be 3 to 32 characters"}
	}
	if !usernamePattern.MatchString(u) {
		return "", &ValidationError{Field: "username", Reason: "use lowercase letters, digits, and underscores, starting with a letter"}
	}
	if reserved[u] {
		return "", &ValidationError{Field: "username", Reason: "this username is reserved"}
	}
	return u, nil
}

// ValidateDisplayName trims the name and checks its length and characters.
func ValidateDisplayName(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if n := utf8.RuneCountInString(s); n < 1 || n > displayNameMax {
		return "", &ValidationError{Field: "displayName", Reason: "must be 1 to 64 characters"}
	}
	if hasControl(s) {
		return "", &ValidationError{Field: "displayName", Reason: "must not contain control characters"}
	}
	return s, nil
}

// ValidateBio trims the bio and checks its length and characters. An empty bio is allowed.
func ValidateBio(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if utf8.RuneCountInString(s) > bioMax {
		return "", &ValidationError{Field: "bio", Reason: "must be at most 300 characters"}
	}
	if hasControl(s) {
		return "", &ValidationError{Field: "bio", Reason: "must not contain control characters"}
	}
	return s, nil
}

// ValidateAvatarURL accepts only https URLs without credentials, at most 2048 characters.
func ValidateAvatarURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	bad := &ValidationError{Field: "avatarUrl", Reason: "must be an https URL of at most 2048 characters"}
	if s == "" || len(s) > avatarURLMax {
		return "", bad
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return "", bad
	}
	return s, nil
}

func hasControl(s string) bool {
	for _, r := range s {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

// Repo reads and writes profiles.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo returns a profile repository.
func NewRepo(pool *pgxpool.Pool) *Repo { return &Repo{pool: pool} }

// Me returns the profile of userID.
func (r *Repo) Me(ctx context.Context, userID string) (Me, error) {
	var m Me
	err := r.pool.QueryRow(ctx,
		`SELECT u.id::text, COALESCE(e.email, ''), u.username, u.display_name, u.bio, u.avatar_url
		   FROM users u
		   LEFT JOIN LATERAL (
		       SELECT email FROM email_identities WHERE user_id = u.id ORDER BY created_at LIMIT 1
		   ) e ON true
		  WHERE u.id = $1`, userID).Scan(&m.ID, &m.Email, &m.Username, &m.DisplayName, &m.Bio, &m.AvatarURL)
	if err != nil {
		return Me{}, fmt.Errorf("read profile: %w", err)
	}
	return m, nil
}

// Public returns the public profile for a username. The lookup is case-insensitive.
func (r *Repo) Public(ctx context.Context, username string) (Public, error) {
	u := strings.ToLower(strings.TrimSpace(username))
	var p Public
	err := r.pool.QueryRow(ctx,
		`SELECT id::text, username, display_name, bio, avatar_url FROM users WHERE username = $1`,
		u).Scan(&p.ID, &p.Username, &p.DisplayName, &p.Bio, &p.AvatarURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return Public{}, ErrNotFound
	}
	if err != nil {
		return Public{}, fmt.Errorf("read public profile: %w", err)
	}
	return p, nil
}

// Update applies a partial update to userID's profile. Validation runs before
// any write. A username is taken by a unique constraint, so two concurrent
// requests cannot both succeed.
func (r *Repo) Update(ctx context.Context, userID string, p Patch) (Me, error) {
	upd, err := validatePatch(p)
	if err != nil {
		return Me{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Me{}, fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 FOR UPDATE)`, userID).Scan(&exists); err != nil {
		return Me{}, fmt.Errorf("lock profile: %w", err)
	}
	if !exists {
		return Me{}, fmt.Errorf("profile for signed-in user is missing")
	}

	if _, err := tx.Exec(ctx,
		`UPDATE users
		    SET username     = CASE WHEN $2 THEN $3 ELSE username END,
		        display_name = CASE WHEN $4 THEN $5 ELSE display_name END,
		        bio          = CASE WHEN $6 THEN $7 ELSE bio END,
		        avatar_url   = CASE WHEN $8 THEN $9 ELSE avatar_url END,
		        updated_at   = now()
		  WHERE id = $1`,
		userID,
		upd.username.set, upd.username.value,
		upd.displayName.set, upd.displayName.value,
		upd.bio.set, upd.bio.value,
		upd.avatarURL.set, upd.avatarURL.value,
	); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == usernameConstraint {
			return Me{}, ErrUsernameTaken
		}
		return Me{}, fmt.Errorf("update profile: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Me{}, fmt.Errorf("commit profile: %w", err)
	}
	return r.Me(ctx, userID)
}

// setting is one column to write. set false leaves the column unchanged.
type setting struct {
	set   bool
	value *string
}

type update struct {
	username, displayName, bio, avatarURL setting
}

// validatePatch checks every present field and turns it into a column update.
// Null clears bio and avatarUrl. Username and displayName cannot be cleared.
func validatePatch(p Patch) (update, error) {
	var u update
	var err error
	if p.Username.Present {
		if p.Username.Null {
			return u, &ValidationError{Field: "username", Reason: "cannot be cleared"}
		}
		var v string
		if v, err = ValidateUsername(p.Username.Value); err != nil {
			return u, err
		}
		u.username = setting{set: true, value: &v}
	}
	if p.DisplayName.Present {
		if p.DisplayName.Null {
			return u, &ValidationError{Field: "displayName", Reason: "cannot be cleared"}
		}
		var v string
		if v, err = ValidateDisplayName(p.DisplayName.Value); err != nil {
			return u, err
		}
		u.displayName = setting{set: true, value: &v}
	}
	if p.Bio.Present {
		if p.Bio.Null {
			u.bio = setting{set: true, value: nil}
		} else {
			var v string
			if v, err = ValidateBio(p.Bio.Value); err != nil {
				return u, err
			}
			u.bio = setting{set: true, value: &v}
		}
	}
	if p.AvatarURL.Present {
		if p.AvatarURL.Null {
			u.avatarURL = setting{set: true, value: nil}
		} else {
			var v string
			if v, err = ValidateAvatarURL(p.AvatarURL.Value); err != nil {
				return u, err
			}
			u.avatarURL = setting{set: true, value: &v}
		}
	}
	return u, nil
}
