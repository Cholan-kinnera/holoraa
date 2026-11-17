package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// The tables from migrations 00001 through 00004 must come and go cleanly.
// The test rolls back all migrations, checks the tables are gone, and migrates up again.
func TestMigrationsRoundTripFromAnEmptyDatabase(t *testing.T) {
	pool := testdb.Pool(t) // already migrated to the latest version
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)

	for i := 0; i < 4; i++ {
		if _, err := store.RunMigrations(ctx, db, store.OpDown); err != nil {
			t.Fatalf("down step %d: %v", i+1, err)
		}
	}
	var presentUsers, presentFollows, presentConversations, presentMessages *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.users')::text`).Scan(&presentUsers); err != nil {
		t.Fatal(err)
	}
	if presentUsers != nil {
		t.Fatalf("users table still exists after rolling back: %s", *presentUsers)
	}
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.follows')::text`).Scan(&presentFollows); err != nil {
		t.Fatal(err)
	}
	if presentFollows != nil {
		t.Fatalf("follows table still exists after rolling back: %s", *presentFollows)
	}
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.conversations')::text`).Scan(&presentConversations); err != nil {
		t.Fatal(err)
	}
	if presentConversations != nil {
		t.Fatalf("conversations table still exists after rolling back: %s", *presentConversations)
	}
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.messages')::text`).Scan(&presentMessages); err != nil {
		t.Fatal(err)
	}
	if presentMessages != nil {
		t.Fatalf("messages table still exists after rolling back: %s", *presentMessages)
	}

	if _, err := store.RunMigrations(ctx, db, store.OpUp); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
	statuses, err := store.RunMigrations(ctx, db, store.OpStatus)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(statuses) < 4 {
		t.Fatalf("status lists %d migrations, want at least 4", len(statuses))
	}
	for _, s := range statuses {
		if s.State != "applied" {
			t.Fatalf("migration %s state = %s, want applied", s.Source.Path, s.State)
		}
	}
}
