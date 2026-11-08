package profile

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// newUser inserts an account and returns its ID. Account creation normally
// happens at sign-in; tests insert the row directly.
func newUser(t testing.TB, repo *Repo, email string) string {
	t.Helper()
	user, err := repo.queries.CreateUser(context.Background())
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	if _, err := repo.queries.CreateEmailIdentity(context.Background(), dbstore.CreateEmailIdentityParams{
		Email:  email,
		UserID: user.ID,
	}); err != nil {
		t.Fatalf("insert identity: %v", err)
	}
	return user.ID
}

func setUsername(v string) Patch {
	return Patch{Username: Field{Present: true, Value: v}}
}

func TestUsernameIsUniqueAndCaseInsensitive(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	alice := newUser(t, repo, "alice@example.test")
	bob := newUser(t, repo, "bob@example.test")

	if _, err := repo.Update(context.Background(), alice, setUsername("Alice_01")); err != nil {
		t.Fatalf("alice claims a username: %v", err)
	}
	_, err := repo.Update(context.Background(), bob, setUsername("alice_01"))
	if !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("bob takes alice's username: %v, want ErrUsernameTaken", err)
	}
}

func TestConcurrentUsernameClaimCollision(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	const concurrency = 10
	userIDs := make([]string, concurrency)
	for i := 0; i < concurrency; i++ {
		userIDs[i] = newUser(t, repo, "concurrent_"+string(rune('a'+i))+"@example.test")
	}

	targetUsername := "contested_handle"
	start := make(chan struct{})
	var wg sync.WaitGroup
	var successCount atomic.Int32
	var conflictCount atomic.Int32
	var winnerID atomic.Value

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(uid string) {
			defer wg.Done()
			<-start
			me, err := repo.Update(context.Background(), uid, setUsername(targetUsername))
			if err == nil {
				successCount.Add(1)
				winnerID.Store(me.ID)
			} else if errors.Is(err, ErrUsernameTaken) {
				conflictCount.Add(1)
			} else {
				t.Errorf("unexpected error for %s: %v", uid, err)
			}
		}(userIDs[i])
	}

	close(start)
	wg.Wait()

	if successCount.Load() != 1 {
		t.Fatalf("expected exactly 1 successful claim, got %d", successCount.Load())
	}
	if conflictCount.Load() != concurrency-1 {
		t.Fatalf("expected %d conflicts, got %d", concurrency-1, conflictCount.Load())
	}

	winner, ok := winnerID.Load().(string)
	if !ok || winner == "" {
		t.Fatal("no winning user ID recorded")
	}

	// Verify authoritative database state matches the winner
	public, err := repo.Public(context.Background(), targetUsername)
	if err != nil {
		t.Fatalf("fetch claimed public profile: %v", err)
	}
	if public.ID != winner {
		t.Fatalf("public profile ID = %s, want winner %s", public.ID, winner)
	}
}

func TestUpdateChangesOnlyTheCallersProfile(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	alice := newUser(t, repo, "owner-a@example.test")
	bob := newUser(t, repo, "owner-b@example.test")
	if _, err := repo.Update(context.Background(), bob, Patch{DisplayName: Field{Present: true, Value: "Bob"}}); err != nil {
		t.Fatal(err)
	}

	me, err := repo.Update(context.Background(), alice, Patch{
		Username:    Field{Present: true, Value: "alice_two"},
		DisplayName: Field{Present: true, Value: "Alice"},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if me.ID != alice || me.Username == nil || *me.Username != "alice_two" || !me.Complete() {
		t.Fatalf("updated profile = %+v", me)
	}
	other, err := repo.Me(context.Background(), bob)
	if err != nil {
		t.Fatal(err)
	}
	if other.DisplayName == nil || *other.DisplayName != "Bob" || other.Username != nil {
		t.Fatalf("another user's profile changed: %+v", other)
	}
}

func TestPartialUpdatePreservesExistingFields(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	id := newUser(t, repo, "partial@example.test")

	// Set initial complete profile
	initial, err := repo.Update(context.Background(), id, Patch{
		Username:    Field{Present: true, Value: "partial_user"},
		DisplayName: Field{Present: true, Value: "Initial Name"},
		Bio:         Field{Present: true, Value: "Initial Bio"},
		AvatarURL:   Field{Present: true, Value: "https://cdn.example.test/initial.png"},
	})
	if err != nil {
		t.Fatalf("initial update: %v", err)
	}
	if !initial.Complete() {
		t.Fatal("initial profile must be complete")
	}

	// Partial update: only displayName
	afterName, err := repo.Update(context.Background(), id, Patch{
		DisplayName: Field{Present: true, Value: "Updated Name"},
	})
	if err != nil {
		t.Fatalf("patch display name: %v", err)
	}
	if *afterName.DisplayName != "Updated Name" {
		t.Fatalf("display name = %v, want 'Updated Name'", afterName.DisplayName)
	}
	if *afterName.Username != "partial_user" {
		t.Fatalf("username mutated: %v", afterName.Username)
	}
	if *afterName.Bio != "Initial Bio" {
		t.Fatalf("bio mutated: %v", afterName.Bio)
	}
	if *afterName.AvatarURL != "https://cdn.example.test/initial.png" {
		t.Fatalf("avatar URL mutated: %v", afterName.AvatarURL)
	}

	// Partial update: empty bio and avatarUrl clears them
	cleared, err := repo.Update(context.Background(), id, Patch{
		Bio:       Field{Present: true, Value: ""},
		AvatarURL: Field{Present: true, Value: ""},
	})
	if err != nil {
		t.Fatalf("clear via empty string: %v", err)
	}
	if cleared.Bio != nil {
		t.Fatalf("empty bio did not clear column: %v", cleared.Bio)
	}
	if cleared.AvatarURL != nil {
		t.Fatalf("empty avatarUrl did not clear column: %v", cleared.AvatarURL)
	}
	if *cleared.DisplayName != "Updated Name" || *cleared.Username != "partial_user" {
		t.Fatalf("unmentioned fields altered during clear: %+v", cleared)
	}
}

func TestNullClearsBioAndAvatar(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	id := newUser(t, repo, "clear@example.test")
	bio := "hello"
	avatar := "https://cdn.example.test/a.png"
	if _, err := repo.Update(context.Background(), id, Patch{
		Bio:       Field{Present: true, Value: bio},
		AvatarURL: Field{Present: true, Value: avatar},
	}); err != nil {
		t.Fatal(err)
	}
	me, err := repo.Update(context.Background(), id, Patch{
		Bio:       Field{Present: true, Null: true},
		AvatarURL: Field{Present: true, Null: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if me.Bio != nil || me.AvatarURL != nil {
		t.Fatalf("null did not clear the fields: %+v", me)
	}
}

func TestPublicProfileStrictPrivacyIsolation(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	id := newUser(t, repo, "sensitive-private@example.test")

	// Incomplete profile (username is NULL) cannot be fetched as a public profile
	if _, err := repo.Public(context.Background(), "sensitive-private"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("incomplete user returned public profile: %v, want ErrNotFound", err)
	}

	if _, err := repo.Update(context.Background(), id, Patch{
		Username:    Field{Present: true, Value: "public_isolated"},
		DisplayName: Field{Present: true, Value: "Public Isolated"},
		Bio:         Field{Present: true, Value: "Public Bio"},
		AvatarURL:   Field{Present: true, Value: "https://cdn.example.test/avatar.png"},
	}); err != nil {
		t.Fatal(err)
	}

	p, err := repo.Public(context.Background(), "PUBLIC_ISOLATED")
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if p.Username != "public_isolated" || p.ID != id {
		t.Fatalf("public profile mismatch = %+v", p)
	}
	if p.DisplayName == nil || *p.DisplayName != "Public Isolated" {
		t.Fatalf("displayName mismatch: %v", p.DisplayName)
	}
	if p.Bio == nil || *p.Bio != "Public Bio" {
		t.Fatalf("bio mismatch: %v", p.Bio)
	}
	if p.AvatarURL == nil || *p.AvatarURL != "https://cdn.example.test/avatar.png" {
		t.Fatalf("avatarURL mismatch: %v", p.AvatarURL)
	}

	// Unknown username returns ErrNotFound
	if _, err := repo.Public(context.Background(), "nobody_here"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown username: %v, want ErrNotFound", err)
	}
}

func TestDatabaseRejectsInvalidUsernameEvenIfAppValidationIsBypassed(t *testing.T) {
	pool := testdb.Pool(t)
	id := newUser(t, NewRepo(pool), "constraint@example.test")
	_, err := pool.Exec(context.Background(), `UPDATE users SET username = 'Bad Name' WHERE id = $1`, id)
	if err == nil {
		t.Fatal("the database accepted an invalid username")
	}
}

func TestSearchUsersEmptyAndWhitespace(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	caller := newUser(t, repo, "search-empty-caller@example.test")

	for _, q := range []string{"", "   ", "\t", "\n", " \t \n "} {
		res, err := repo.Search(context.Background(), caller, q, 10)
		if err != nil {
			t.Fatalf("Search(%q) failed: %v", q, err)
		}
		if len(res) != 0 {
			t.Fatalf("Search(%q) returned %d items, want 0", q, len(res))
		}
	}
}

func TestSearchUsersPrefix(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	caller := newUser(t, repo, "caller-prefix@example.test")
	if _, err := repo.Update(context.Background(), caller, setUsername("alex_caller")); err != nil {
		t.Fatal(err)
	}

	alice := newUser(t, repo, "alice@example.test")
	if _, err := repo.Update(context.Background(), alice, setUsername("alice_cooper")); err != nil {
		t.Fatal(err)
	}

	alex := newUser(t, repo, "alex@example.test")
	if _, err := repo.Update(context.Background(), alex, setUsername("alexander")); err != nil {
		t.Fatal(err)
	}

	bob := newUser(t, repo, "bob@example.test")
	if _, err := repo.Update(context.Background(), bob, setUsername("bob_smith")); err != nil {
		t.Fatal(err)
	}

	// Incomplete user (username is NULL)
	_ = newUser(t, repo, "incomplete@example.test")

	// Search "al" (2 characters -> prefix matching)
	results, err := repo.Search(context.Background(), caller, "al", 10)
	if err != nil {
		t.Fatalf("Search('al'): %v", err)
	}

	// Caller must be excluded, incomplete profile excluded, bob excluded
	if len(results) != 2 {
		t.Fatalf("got %d results, want 2: %+v", len(results), results)
	}
	usernames := []string{results[0].Username, results[1].Username}
	if usernames[0] != "alexander" || usernames[1] != "alice_cooper" {
		t.Fatalf("unexpected order or usernames: %v", usernames)
	}
}

func TestSearchUsersTrigramAndRanking(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	caller := newUser(t, repo, "caller-trigram@example.test")

	// 1. Exact username match
	u1 := newUser(t, repo, "u1@example.test")
	if _, err := repo.Update(context.Background(), u1, Patch{
		Username:    Field{Present: true, Value: "alice"},
		DisplayName: Field{Present: true, Value: "Alice One"},
	}); err != nil {
		t.Fatal(err)
	}

	// 2. Prefix username match
	u2 := newUser(t, repo, "u2@example.test")
	if _, err := repo.Update(context.Background(), u2, Patch{
		Username:    Field{Present: true, Value: "alice_dev"},
		DisplayName: Field{Present: true, Value: "Developer Alice"},
	}); err != nil {
		t.Fatal(err)
	}

	// 3. Display name prefix match
	u3 := newUser(t, repo, "u3@example.test")
	if _, err := repo.Update(context.Background(), u3, Patch{
		Username:    Field{Present: true, Value: "charlie_smith"},
		DisplayName: Field{Present: true, Value: "Alice In Wonderland"},
	}); err != nil {
		t.Fatal(err)
	}

	// 4. Substring match
	u4 := newUser(t, repo, "u4@example.test")
	if _, err := repo.Update(context.Background(), u4, Patch{
		Username:    Field{Present: true, Value: "wonderland_alice_fan"},
		DisplayName: Field{Present: true, Value: "Fan Account"},
	}); err != nil {
		t.Fatal(err)
	}

	// Search "alice" (5 characters -> trigram search)
	results, err := repo.Search(context.Background(), caller, "alice", 10)
	if err != nil {
		t.Fatalf("Search('alice'): %v", err)
	}

	if len(results) < 4 {
		t.Fatalf("expected at least 4 results, got %d: %+v", len(results), results)
	}

	// Ranking tier verification:
	// Tier 0: exact handle "alice"
	if results[0].Username != "alice" {
		t.Fatalf("rank 0 = %q, want 'alice'", results[0].Username)
	}
	// Tier 1: prefix handle "alice_dev"
	if results[1].Username != "alice_dev" {
		t.Fatalf("rank 1 = %q, want 'alice_dev'", results[1].Username)
	}
	// Tier 2: display name prefix "charlie_smith" (displayName "Alice In Wonderland")
	if results[2].Username != "charlie_smith" {
		t.Fatalf("rank 2 = %q, want 'charlie_smith'", results[2].Username)
	}
	// Tier 3: substring "wonderland_alice_fan"
	if results[3].Username != "wonderland_alice_fan" {
		t.Fatalf("rank 3 = %q, want 'wonderland_alice_fan'", results[3].Username)
	}
}

func TestSearchUsersWildcardAndSQLInjection(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	caller := newUser(t, repo, "caller-escape@example.test")

	// Users with special characters
	u1 := newUser(t, repo, "u1@example.test")
	if _, err := repo.Update(context.Background(), u1, Patch{
		Username:    Field{Present: true, Value: "user_literal"},
		DisplayName: Field{Present: true, Value: "100% Guaranteed"},
	}); err != nil {
		t.Fatal(err)
	}
	u2 := newUser(t, repo, "u2@example.test")
	if _, err := repo.Update(context.Background(), u2, Patch{
		Username:    Field{Present: true, Value: "regular_user"},
		DisplayName: Field{Present: true, Value: "Regular User"},
	}); err != nil {
		t.Fatal(err)
	}

	// 1. Prefix search with wildcard characters:
	// A raw '%' must not match all users like a wildcard would.
	resPercentPrefix, err := repo.Search(context.Background(), caller, "%", 10)
	if err != nil {
		t.Fatalf("search with percent prefix: %v", err)
	}
	if len(resPercentPrefix) != 0 {
		t.Fatalf("escaped %% should match 0 users, got %d", len(resPercentPrefix))
	}

	// A raw '_' must not match all users like a single-char wildcard.
	resUnderscorePrefix, err := repo.Search(context.Background(), caller, "_", 10)
	if err != nil {
		t.Fatalf("search with underscore prefix: %v", err)
	}
	if len(resUnderscorePrefix) != 0 {
		t.Fatalf("escaped _ should match 0 users, got %d", len(resUnderscorePrefix))
	}

	// 2. Trigram search with multiple wildcards:
	// '%%%' must not match all users.
	resTrigramWildcards, err := repo.Search(context.Background(), caller, "%%%", 10)
	if err != nil {
		t.Fatalf("search with trigram percent: %v", err)
	}
	if len(resTrigramWildcards) != 0 {
		t.Fatalf("escaped %%%%%% should match 0 users, got %d", len(resTrigramWildcards))
	}

	// 3. Search literal '100%' matches user_literal via displayName '100% Guaranteed'
	resPercent, err := repo.Search(context.Background(), caller, "100%", 10)
	if err != nil {
		t.Fatalf("search with 100%%: %v", err)
	}
	if len(resPercent) != 1 || resPercent[0].Username != "user_literal" {
		t.Fatalf("wildcard percent search failed: got %+v, want only 'user_literal'", resPercent)
	}

	// 4. SQL injection attempts are treated strictly as parameterized text
	injections := []string{
		"' OR '1'='1",
		"'; DROP TABLE users; --",
		`" OR ""=""`,
		"\\'; --",
	}
	for _, inj := range injections {
		resInj, err := repo.Search(context.Background(), caller, inj, 10)
		if err != nil {
			t.Fatalf("SQL injection query %q failed: %v", inj, err)
		}
		if len(resInj) != 0 {
			t.Fatalf("SQL injection query %q matched unexpected users: %+v", inj, resInj)
		}
	}
}

func TestSearchUsersLimitAndDeterministicOrdering(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	caller := newUser(t, repo, "caller-limit@example.test")

	// Insert 15 users with consistent prefix
	for i := 1; i <= 15; i++ {
		uid := newUser(t, repo, fmt.Sprintf("batch%02d@example.test", i))
		handle := fmt.Sprintf("batch_user_%02d", i)
		if _, err := repo.Update(context.Background(), uid, setUsername(handle)); err != nil {
			t.Fatal(err)
		}
	}

	// Limit 5
	res5, err := repo.Search(context.Background(), caller, "batch_user", 5)
	if err != nil {
		t.Fatalf("Search limit 5: %v", err)
	}
	if len(res5) != 5 {
		t.Fatalf("expected 5 results, got %d", len(res5))
	}

	// Limit 12
	res12, err := repo.Search(context.Background(), caller, "batch_user", 12)
	if err != nil {
		t.Fatalf("Search limit 12: %v", err)
	}
	if len(res12) != 12 {
		t.Fatalf("expected 12 results, got %d", len(res12))
	}

	// Determinism check: run 5 consecutive times and compare order
	for run := 0; run < 5; run++ {
		resRun, err := repo.Search(context.Background(), caller, "batch_user", 12)
		if err != nil {
			t.Fatal(err)
		}
		for i := range res12 {
			if resRun[i].Username != res12[i].Username {
				t.Fatalf("non-deterministic order at index %d on run %d: got %s, want %s",
					i, run, resRun[i].Username, res12[i].Username)
			}
		}
	}
}

func TestSearchExplainAnalyzeAndPerformance(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	caller := newUser(t, repo, "perf-caller@example.test")

	// Seed 30 users
	for i := 1; i <= 30; i++ {
		uid := newUser(t, repo, fmt.Sprintf("perf_%03d@example.test", i))
		handle := fmt.Sprintf("perf_account_%03d", i)
		name := fmt.Sprintf("Performance User %03d", i)
		if _, err := repo.Update(context.Background(), uid, Patch{
			Username:    Field{Present: true, Value: handle},
			DisplayName: Field{Present: true, Value: name},
		}); err != nil {
			t.Fatal(err)
		}
	}

	ctx := context.Background()

	// 1. Prefix query EXPLAIN ANALYZE
	prefixSQL := `EXPLAIN (ANALYZE, BUFFERS)
SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.following_id = u.id) AS is_following
FROM users u
WHERE u.username IS NOT NULL AND u.id != $1::uuid
  AND (u.username ILIKE $2::text || '%' OR u.display_name ILIKE $2::text || '%')
ORDER BY CASE WHEN u.username ILIKE $2::text || '%' THEN 0 ELSE 1 END, u.username ASC, u.id ASC
LIMIT 10;`

	startPrefix := time.Now()
	rows, err := pool.Query(ctx, prefixSQL, caller, "pe")
	if err != nil {
		t.Fatalf("explain prefix: %v", err)
	}
	var prefixPlan []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		prefixPlan = append(prefixPlan, line)
	}
	rows.Close()
	prefixDuration := time.Since(startPrefix)

	if prefixDuration > 50*time.Millisecond {
		t.Logf("Notice: prefix query took %v (target is sub-50ms)", prefixDuration)
	}
	t.Logf("Prefix query plan:\n%s", strings.Join(prefixPlan, "\n"))

	// 2. Trigram query EXPLAIN ANALYZE
	trigramSQL := `EXPLAIN (ANALYZE, BUFFERS)
SELECT u.id, u.username, u.display_name, u.bio, u.avatar_url,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1::uuid AND f.following_id = u.id) AS is_following
FROM users u
WHERE u.username IS NOT NULL AND u.id != $1::uuid
  AND (u.username ILIKE '%' || $2::text || '%'
       OR u.display_name ILIKE '%' || $2::text || '%'
       OR u.username % $3::text
       OR u.display_name % $3::text)
ORDER BY
    CASE
        WHEN u.username = lower($3::text) THEN 0
        WHEN u.username ILIKE lower($2::text) || '%' THEN 1
        WHEN u.display_name ILIKE $2::text || '%' THEN 2
        ELSE 3
    END,
    similarity(u.username, lower($3::text)) DESC,
    u.username ASC,
    u.id ASC
LIMIT 10;`

	startTrigram := time.Now()
	rowsTri, err := pool.Query(ctx, trigramSQL, caller, "perf", "perf")
	if err != nil {
		t.Fatalf("explain trigram: %v", err)
	}
	var trigramPlan []string
	for rowsTri.Next() {
		var line string
		if err := rowsTri.Scan(&line); err != nil {
			t.Fatal(err)
		}
		trigramPlan = append(trigramPlan, line)
	}
	rowsTri.Close()
	trigramDuration := time.Since(startTrigram)

	if trigramDuration > 50*time.Millisecond {
		t.Logf("Notice: trigram query took %v (target is sub-50ms)", trigramDuration)
	}
	t.Logf("Trigram query plan:\n%s", strings.Join(trigramPlan, "\n"))
}

func BenchmarkSearchPrefix(b *testing.B) {
	pool := testdb.Pool(b)
	repo := NewRepo(pool)
	caller := newUser(b, repo, "bench-prefix-caller@example.test")

	for i := 1; i <= 20; i++ {
		uid := newUser(b, repo, fmt.Sprintf("bpre_%03d@example.test", i))
		_ = repo.queries.CreateUser
		_, _ = repo.Update(context.Background(), uid, setUsername(fmt.Sprintf("bpre_user_%03d", i)))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := repo.Search(context.Background(), caller, "bp", 10)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkSearchTrigram(b *testing.B) {
	pool := testdb.Pool(b)
	repo := NewRepo(pool)
	caller := newUser(b, repo, "bench-trigram-caller@example.test")

	for i := 1; i <= 20; i++ {
		uid := newUser(b, repo, fmt.Sprintf("btri_%03d@example.test", i))
		_, _ = repo.Update(context.Background(), uid, setUsername(fmt.Sprintf("btri_user_%03d", i)))
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := repo.Search(context.Background(), caller, "btri_user", 10)
		if err != nil {
			b.Fatal(err)
		}
	}
}

func TestFollowAndUnfollow(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_f@example.test")
	bob := newUser(t, repo, "bob_f@example.test")

	if _, err := repo.Update(ctx, alice, setUsername("alice_f")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}
	if _, err := repo.Update(ctx, bob, setUsername("bob_f")); err != nil {
		t.Fatalf("setup bob: %v", err)
	}

	// Initial relationship
	following, err := repo.IsFollowing(ctx, alice, bob)
	if err != nil {
		t.Fatalf("is_following initial: %v", err)
	}
	if following {
		t.Fatal("expected alice not to be following bob initially")
	}

	followers, followingCount, err := repo.FollowCounts(ctx, bob)
	if err != nil || followers != 0 || followingCount != 0 {
		t.Fatalf("initial bob counts: followers=%d, following=%d, err=%v", followers, followingCount, err)
	}

	// Alice follows Bob
	if err := repo.Follow(ctx, alice, "bob_f"); err != nil {
		t.Fatalf("alice follow bob: %v", err)
	}

	following, err = repo.IsFollowing(ctx, alice, bob)
	if err != nil || !following {
		t.Fatalf("expected alice to be following bob, got %v, err=%v", following, err)
	}

	followers, followingCount, err = repo.FollowCounts(ctx, bob)
	if err != nil || followers != 1 || followingCount != 0 {
		t.Fatalf("bob counts after follow: followers=%d (want 1), following=%d (want 0), err=%v", followers, followingCount, err)
	}

	followers, followingCount, err = repo.FollowCounts(ctx, alice)
	if err != nil || followers != 0 || followingCount != 1 {
		t.Fatalf("alice counts after follow: followers=%d (want 0), following=%d (want 1), err=%v", followers, followingCount, err)
	}

	// PublicWithRelationship perspective check
	relBob, err := repo.PublicWithRelationship(ctx, alice, "bob_f")
	if err != nil {
		t.Fatalf("read bob with relationship: %v", err)
	}
	if !relBob.IsFollowing || relBob.FollowersCount != 1 || relBob.FollowingCount != 0 {
		t.Fatalf("relBob mismatch: isFollowing=%v, followers=%d, following=%d", relBob.IsFollowing, relBob.FollowersCount, relBob.FollowingCount)
	}

	// Alice unfollows Bob
	if err := repo.Unfollow(ctx, alice, "bob_f"); err != nil {
		t.Fatalf("alice unfollow bob: %v", err)
	}

	following, err = repo.IsFollowing(ctx, alice, bob)
	if err != nil || following {
		t.Fatalf("expected alice not to be following bob after unfollow, got %v, err=%v", following, err)
	}

	followers, followingCount, err = repo.FollowCounts(ctx, bob)
	if err != nil || followers != 0 || followingCount != 0 {
		t.Fatalf("bob counts after unfollow: followers=%d, following=%d, err=%v", followers, followingCount, err)
	}
}

func TestFollowAndUnfollowIdempotency(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_idem@example.test")
	bob := newUser(t, repo, "bob_idem@example.test")

	if _, err := repo.Update(ctx, alice, setUsername("alice_idem")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}
	if _, err := repo.Update(ctx, bob, setUsername("bob_idem")); err != nil {
		t.Fatalf("setup bob: %v", err)
	}

	// Multiple sequential follows
	for i := 1; i <= 3; i++ {
		if err := repo.Follow(ctx, alice, "bob_idem"); err != nil {
			t.Fatalf("follow iteration %d failed: %v", i, err)
		}
	}

	followers, _, err := repo.FollowCounts(ctx, bob)
	if err != nil || followers != 1 {
		t.Fatalf("followers count after repeated follows = %d, want 1", followers)
	}

	// Multiple sequential unfollows
	for i := 1; i <= 3; i++ {
		if err := repo.Unfollow(ctx, alice, "bob_idem"); err != nil {
			t.Fatalf("unfollow iteration %d failed: %v", i, err)
		}
	}

	followers, _, err = repo.FollowCounts(ctx, bob)
	if err != nil || followers != 0 {
		t.Fatalf("followers count after repeated unfollows = %d, want 0", followers)
	}
}

func TestFollowSelfRejected(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_self@example.test")
	if _, err := repo.Update(ctx, alice, setUsername("alice_self")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}

	err := repo.Follow(ctx, alice, "alice_self")
	if !errors.Is(err, ErrCannotFollowSelf) {
		t.Fatalf("follow self error = %v, want ErrCannotFollowSelf", err)
	}

	err = repo.Follow(ctx, alice, "  ALICE_SELF  ")
	if !errors.Is(err, ErrCannotFollowSelf) {
		t.Fatalf("follow self case-insensitive error = %v, want ErrCannotFollowSelf", err)
	}

	// Direct database constraint verification
	_, dbErr := pool.Exec(ctx, "INSERT INTO follows (follower_id, following_id) VALUES ($1, $1)", alice)
	if dbErr == nil {
		t.Fatal("expected database constraint violation inserting self-follow into follows, got nil")
	}
	if !strings.Contains(dbErr.Error(), "follows_check") && !strings.Contains(dbErr.Error(), "23514") {
		t.Fatalf("expected follows_check or 23514 constraint error, got %v", dbErr)
	}
}

func TestFollowNonexistentUser(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_nonexistent@example.test")
	if _, err := repo.Update(ctx, alice, setUsername("alice_nonexistent")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}

	err := repo.Follow(ctx, alice, "nobody_here_123")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("follow nonexistent error = %v, want ErrNotFound", err)
	}

	err = repo.Unfollow(ctx, alice, "nobody_here_123")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unfollow nonexistent error = %v, want ErrNotFound", err)
	}

	// User without username cannot be followed
	bobIncomplete := newUser(t, repo, "bob_incomplete@example.test")
	_ = bobIncomplete
	err = repo.Follow(ctx, alice, "bob_incomplete")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("follow incomplete user error = %v, want ErrNotFound", err)
	}
}

func TestFollowCaseInsensitive(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_casing@example.test")
	bob := newUser(t, repo, "bob_casing@example.test")

	if _, err := repo.Update(ctx, alice, setUsername("alice_casing")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}
	if _, err := repo.Update(ctx, bob, setUsername("bob_casing")); err != nil {
		t.Fatalf("setup bob: %v", err)
	}

	if err := repo.Follow(ctx, alice, "  BOB_CASING  "); err != nil {
		t.Fatalf("follow uppercase with whitespace failed: %v", err)
	}

	following, err := repo.IsFollowing(ctx, alice, bob)
	if err != nil || !following {
		t.Fatalf("expected following to be true after case-insensitive follow, got %v, err=%v", following, err)
	}

	if err := repo.Unfollow(ctx, alice, "  BoB_CaSiNg  "); err != nil {
		t.Fatalf("unfollow mixed case failed: %v", err)
	}

	following, err = repo.IsFollowing(ctx, alice, bob)
	if err != nil || following {
		t.Fatalf("expected following to be false after case-insensitive unfollow, got %v, err=%v", following, err)
	}
}

func TestConcurrentDuplicateFollows(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	bob := newUser(t, repo, "bob_concurrent@example.test")
	if _, err := repo.Update(ctx, bob, setUsername("bob_concurrent")); err != nil {
		t.Fatalf("setup bob: %v", err)
	}

	const callers = 10
	callerIDs := make([]string, callers)
	for i := 0; i < callers; i++ {
		callerIDs[i] = newUser(t, repo, fmt.Sprintf("concurrent_follower_%02d@example.test", i))
		if _, err := repo.Update(ctx, callerIDs[i], setUsername(fmt.Sprintf("cfollower_%02d", i))); err != nil {
			t.Fatalf("setup follower %d: %v", i, err)
		}
	}

	// 10 distinct followers simultaneously follow Bob
	var wg sync.WaitGroup
	start := make(chan struct{})
	var errCount atomic.Int32

	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(uid string) {
			defer wg.Done()
			<-start
			if err := repo.Follow(ctx, uid, "bob_concurrent"); err != nil {
				errCount.Add(1)
				t.Errorf("concurrent follow by %s failed: %v", uid, err)
			}
		}(callerIDs[i])
	}

	close(start)
	wg.Wait()

	if errCount.Load() != 0 {
		t.Fatalf("%d errors occurred during concurrent follows", errCount.Load())
	}

	followers, _, err := repo.FollowCounts(ctx, bob)
	if err != nil || followers != callers {
		t.Fatalf("bob followers count = %d, want %d", followers, callers)
	}

	// Same caller (callerIDs[0]) calls follow concurrently 10 times
	startDup := make(chan struct{})
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-startDup
			if err := repo.Follow(ctx, callerIDs[0], "bob_concurrent"); err != nil {
				errCount.Add(1)
				t.Errorf("duplicate concurrent follow failed: %v", err)
			}
		}()
	}

	close(startDup)
	wg.Wait()

	followers, _, err = repo.FollowCounts(ctx, bob)
	if err != nil || followers != callers {
		t.Fatalf("bob followers count after duplicate follows = %d, want %d", followers, callers)
	}
}

func TestConcurrentFollowUnfollow(t *testing.T) {
	pool := testdb.Pool(t)
	repo := NewRepo(pool)
	ctx := context.Background()

	alice := newUser(t, repo, "alice_race@example.test")
	bob := newUser(t, repo, "bob_race@example.test")

	if _, err := repo.Update(ctx, alice, setUsername("alice_race")); err != nil {
		t.Fatalf("setup alice: %v", err)
	}
	if _, err := repo.Update(ctx, bob, setUsername("bob_race")); err != nil {
		t.Fatalf("setup bob: %v", err)
	}

	const iterations = 15
	var wg sync.WaitGroup
	start := make(chan struct{})
	var errCount atomic.Int32

	for i := 0; i < iterations; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			if err := repo.Follow(ctx, alice, "bob_race"); err != nil {
				errCount.Add(1)
				t.Errorf("concurrent follow error: %v", err)
			}
		}()
		go func() {
			defer wg.Done()
			<-start
			if err := repo.Unfollow(ctx, alice, "bob_race"); err != nil {
				errCount.Add(1)
				t.Errorf("concurrent unfollow error: %v", err)
			}
		}()
	}

	close(start)
	wg.Wait()

	if errCount.Load() != 0 {
		t.Fatalf("%d errors occurred during concurrent follow/unfollow", errCount.Load())
	}

	// Verify database state is self-consistent
	following, err := repo.IsFollowing(ctx, alice, bob)
	if err != nil {
		t.Fatalf("is_following check failed: %v", err)
	}
	followers, _, err := repo.FollowCounts(ctx, bob)
	if err != nil {
		t.Fatalf("follow_counts check failed: %v", err)
	}

	expectedFollowers := int64(0)
	if following {
		expectedFollowers = 1
	}
	if followers != expectedFollowers {
		t.Fatalf("consistency mismatch: isFollowing=%v but followersCount=%d", following, followers)
	}
}
