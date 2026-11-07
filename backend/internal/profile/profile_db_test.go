package profile

import (
	"context"
	"errors"
	"testing"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// newUser inserts an account and returns its ID. Account creation normally
// happens at sign-in; tests insert the row directly.
func newUser(t *testing.T, repo *Repo, email string) string {
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

func TestPublicProfileHasNoEmailAndIsCaseInsensitive(t *testing.T) {
	repo := NewRepo(testdb.Pool(t))
	id := newUser(t, repo, "private@example.test")
	if _, err := repo.Update(context.Background(), id, setUsername("public_one")); err != nil {
		t.Fatal(err)
	}
	p, err := repo.Public(context.Background(), "PUBLIC_one")
	if err != nil {
		t.Fatalf("Public: %v", err)
	}
	if p.Username != "public_one" || p.ID != id {
		t.Fatalf("public profile = %+v", p)
	}
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
