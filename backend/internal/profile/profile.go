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
	"net"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
)

// Limits. They match the database check constraints in migration 00002.
const (
	usernameMin        = 3
	usernameMax        = 32
	displayNameMax     = 50
	bioMax             = 160
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
	// ErrCannotFollowSelf means a user attempted to follow their own account.
	ErrCannotFollowSelf = errors.New("cannot follow self")
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
		return "", &ValidationError{Field: "displayName", Reason: "must be 1 to 50 characters"}
	}
	if hasControl(s) {
		return "", &ValidationError{Field: "displayName", Reason: "must not contain control characters"}
	}
	return s, nil
}

// cleanBio strips control characters except newlines, collapses multiple consecutive
// newlines into a single internal newline, and trims surrounding whitespace.
func cleanBio(raw string) string {
	s := strings.ReplaceAll(raw, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")

	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\n' || !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}
	cleaned := b.String()

	for strings.Contains(cleaned, "\n\n") {
		cleaned = strings.ReplaceAll(cleaned, "\n\n", "\n")
	}

	return strings.TrimSpace(cleaned)
}

// ValidateBio trims and cleans the bio, enforcing single internal newlines and stripping
// control characters, then checks its length. An empty bio is allowed.
func ValidateBio(raw string) (string, error) {
	s := cleanBio(raw)
	if utf8.RuneCountInString(s) > bioMax {
		return "", &ValidationError{Field: "bio", Reason: "must be at most 160 characters"}
	}
	return s, nil
}

// isLocalOrInternalHost reports whether the host represents a loopback, local network,
// or non-routable address that should be rejected for external avatar images.
func isLocalOrInternalHost(hostStr string) bool {
	hostname := hostStr
	if h, _, err := net.SplitHostPort(hostStr); err == nil {
		hostname = h
	}
	hostname = strings.ToLower(strings.TrimSpace(hostname))
	if hostname == "" {
		return true
	}

	if hostname == "localhost" || hostname == "broadcasthost" ||
		hostname == "ip6-localhost" || hostname == "ip6-loopback" {
		return true
	}
	for _, suffix := range []string{".localhost", ".local", ".internal", ".lan", ".home.arpa"} {
		if strings.HasSuffix(hostname, suffix) {
			return true
		}
	}

	if ip := net.ParseIP(hostname); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return true
		}
		if ip4 := ip.To4(); ip4 != nil {
			if ip4.IsLoopback() || ip4.IsPrivate() || ip4.IsLinkLocalUnicast() || ip4.IsLinkLocalMulticast() || ip4.IsUnspecified() {
				return true
			}
		}
	}

	if !strings.Contains(hostname, ".") {
		return true
	}

	return false
}

// ValidateAvatarURL accepts an empty string or an https URL with a public hostname, at most 2048 characters.
func ValidateAvatarURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	bad := &ValidationError{Field: "avatarUrl", Reason: "must be an https URL of at most 2048 characters"}
	if len(s) > avatarURLMax {
		return "", bad
	}
	u, err := url.Parse(s)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return "", bad
	}
	if isLocalOrInternalHost(u.Host) {
		return "", &ValidationError{Field: "avatarUrl", Reason: "must not use a local or internal host"}
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
	pool    *pgxpool.Pool
	queries *dbstore.Queries
}

// NewRepo returns a profile repository.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{
		pool:    pool,
		queries: dbstore.New(pool),
	}
}

// Me returns the profile of userID.
func (r *Repo) Me(ctx context.Context, userID string) (Me, error) {
	row, err := r.queries.GetProfileMe(ctx, userID)
	if err != nil {
		return Me{}, fmt.Errorf("read profile: %w", err)
	}
	return Me{
		ID:          row.ID,
		Email:       row.Email,
		Username:    row.Username,
		DisplayName: row.DisplayName,
		Bio:         row.Bio,
		AvatarURL:   row.AvatarUrl,
	}, nil
}

// Public returns the public profile for a username. The lookup is case-insensitive.
func (r *Repo) Public(ctx context.Context, username string) (Public, error) {
	u := strings.ToLower(strings.TrimSpace(username))
	row, err := r.queries.GetPublicProfile(ctx, u)
	if errors.Is(err, pgx.ErrNoRows) {
		return Public{}, ErrNotFound
	}
	if err != nil {
		return Public{}, fmt.Errorf("read public profile: %w", err)
	}
	uname := ""
	if row.Username != nil {
		uname = *row.Username
	}
	return Public{
		ID:          row.ID,
		Username:    uname,
		DisplayName: row.DisplayName,
		Bio:         row.Bio,
		AvatarURL:   row.AvatarUrl,
	}, nil
}

// UserSummary represents a discovered user in search results.
type UserSummary struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"displayName"`
	Bio         *string `json:"bio"`
	AvatarURL   *string `json:"avatarUrl"`
	IsFollowing bool    `json:"isFollowing"`
}

// EscapeLikeWildcards escapes %, _, and \ so that user-provided text can be safely
// embedded in a SQL LIKE pattern without wildcard injection.
func EscapeLikeWildcards(raw string) string {
	s := strings.ReplaceAll(raw, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// Search routes queries to prefix or trigram matching based on rune length.
// Empty or whitespace-only queries return an empty slice immediately without
// executing a database query.
func (r *Repo) Search(ctx context.Context, callerID, rawQuery string, limit int) ([]UserSummary, error) {
	q := strings.TrimSpace(rawQuery)
	if q == "" {
		return []UserSummary{}, nil
	}
	if limit <= 0 {
		limit = 10
	} else if limit > 20 {
		limit = 20
	}

	sanitized := EscapeLikeWildcards(q)

	if utf8.RuneCountInString(q) < 3 {
		rows, err := r.queries.SearchUsersPrefix(ctx, dbstore.SearchUsersPrefixParams{
			CallerID:    callerID,
			PrefixQuery: sanitized,
			LimitVal:    int32(limit),
		})
		if err != nil {
			return nil, fmt.Errorf("search users prefix: %w", err)
		}
		res := make([]UserSummary, len(rows))
		for i, row := range rows {
			uname := ""
			if row.Username != nil {
				uname = *row.Username
			}
			res[i] = UserSummary{
				ID:          row.ID,
				Username:    uname,
				DisplayName: row.DisplayName,
				Bio:         row.Bio,
				AvatarURL:   row.AvatarUrl,
				IsFollowing: row.IsFollowing,
			}
		}
		return res, nil
	}

	rows, err := r.queries.SearchUsersTrigram(ctx, dbstore.SearchUsersTrigramParams{
		CallerID:     callerID,
		EscapedQuery: sanitized,
		RawQuery:     q,
		LimitVal:     int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("search users trigram: %w", err)
	}
	res := make([]UserSummary, len(rows))
	for i, row := range rows {
		uname := ""
		if row.Username != nil {
			uname = *row.Username
		}
		res[i] = UserSummary{
			ID:          row.ID,
			Username:    uname,
			DisplayName: row.DisplayName,
			Bio:         row.Bio,
			AvatarURL:   row.AvatarUrl,
			IsFollowing: row.IsFollowing,
		}
	}
	return res, nil
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
			if v == "" {
				u.bio = setting{set: true, value: nil}
			} else {
				u.bio = setting{set: true, value: &v}
			}
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
			if v == "" {
				u.avatarURL = setting{set: true, value: nil}
			} else {
				u.avatarURL = setting{set: true, value: &v}
			}
		}
	}
	return u, nil
}

// Follow creates a directional follow relationship from followerID to followingUsername.
// It is idempotent: repeated calls succeed without error or duplicate rows.
// Self-follow attempts are rejected.
func (r *Repo) Follow(ctx context.Context, followerID, followingUsername string) error {
	u := strings.ToLower(strings.TrimSpace(followingUsername))
	if u == "" {
		return ErrNotFound
	}
	target, err := r.Public(ctx, u)
	if err != nil {
		return err
	}
	if target.ID == followerID {
		return ErrCannotFollowSelf
	}
	err = r.queries.FollowUser(ctx, dbstore.FollowUserParams{
		FollowerID:        followerID,
		FollowingUsername: u,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			if pgErr.Code == "23514" { // check_violation (follows_no_self_follow)
				return ErrCannotFollowSelf
			}
			if pgErr.Code == "23502" { // not_null_violation (e.g. concurrent user deletion)
				return ErrNotFound
			}
		}
		return fmt.Errorf("follow user: %w", err)
	}
	return nil
}

// Unfollow removes a directional follow relationship from followerID to followingUsername.
// It is idempotent: repeated calls succeed without error.
func (r *Repo) Unfollow(ctx context.Context, followerID, followingUsername string) error {
	u := strings.ToLower(strings.TrimSpace(followingUsername))
	if u == "" {
		return ErrNotFound
	}
	_, err := r.Public(ctx, u)
	if err != nil {
		return err
	}
	err = r.queries.UnfollowUser(ctx, dbstore.UnfollowUserParams{
		FollowerID:        followerID,
		FollowingUsername: u,
	})
	if err != nil {
		return fmt.Errorf("unfollow user: %w", err)
	}
	return nil
}

// IsFollowing reports whether followerID follows followingID.
func (r *Repo) IsFollowing(ctx context.Context, followerID, followingID string) (bool, error) {
	return r.queries.IsFollowing(ctx, dbstore.IsFollowingParams{
		FollowerID:  followerID,
		FollowingID: followingID,
	})
}

// FollowCounts returns the followers count and following count for userID.
func (r *Repo) FollowCounts(ctx context.Context, userID string) (followers int64, following int64, err error) {
	row, err := r.queries.GetFollowCounts(ctx, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("get follow counts: %w", err)
	}
	return row.FollowersCount, row.FollowingCount, nil
}

// PublicWithRelationship represents a public profile with social relationship data relative to the caller.
type PublicWithRelationship struct {
	ID             string  `json:"id"`
	Username       string  `json:"username"`
	DisplayName    *string `json:"displayName"`
	Bio            *string `json:"bio"`
	AvatarURL      *string `json:"avatarUrl"`
	FollowersCount int64   `json:"followersCount"`
	FollowingCount int64   `json:"followingCount"`
	IsFollowing    bool    `json:"isFollowing"`
}

// PublicWithRelationship returns the public profile with social graph counts and caller follow status.
func (r *Repo) PublicWithRelationship(ctx context.Context, callerID, username string) (PublicWithRelationship, error) {
	u := strings.ToLower(strings.TrimSpace(username))
	row, err := r.queries.GetPublicProfileWithRelationship(ctx, dbstore.GetPublicProfileWithRelationshipParams{
		CallerID: callerID,
		Username: u,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicWithRelationship{}, ErrNotFound
	}
	if err != nil {
		return PublicWithRelationship{}, fmt.Errorf("read public profile with relationship: %w", err)
	}
	uname := ""
	if row.Username != nil {
		uname = *row.Username
	}
	return PublicWithRelationship{
		ID:             row.ID,
		Username:       uname,
		DisplayName:    row.DisplayName,
		Bio:            row.Bio,
		AvatarURL:      row.AvatarUrl,
		FollowersCount: row.FollowersCount,
		FollowingCount: row.FollowingCount,
		IsFollowing:    row.IsFollowing,
	}, nil
}
