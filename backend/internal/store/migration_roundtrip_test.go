package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// The auth tables from migration 00002 must come and go cleanly. The test
// rolls back both migrations, checks the tables are gone, and migrates up again.
func TestMigrationsRoundTripFromAnEmptyDatabase(t *testing.T) {
	pool := testdb.Pool(t) // already migrated to the latest version
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)

	for i := 0; i < 2; i++ {
		if _, err := store.RunMigrations(ctx, db, store.OpDown); err != nil {
			t.Fatalf("down step %d: %v", i+1, err)
		}
	}
	var present *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.users')::text`).Scan(&present); err != nil {
		t.Fatal(err)
	}
	if present != nil {
		t.Fatalf("users table still exists after rolling back: %s", *present)
	}

	if _, err := store.RunMigrations(ctx, db, store.OpUp); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
	statuses, err := store.RunMigrations(ctx, db, store.OpStatus)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(statuses) < 2 {
		t.Fatalf("status lists %d migrations, want at least 2", len(statuses))
	}
	for _, s := range statuses {
		if s.State != "applied" {
			t.Fatalf("migration %s state = %s, want applied", s.Source.Path, s.State)
		}
	}
}
