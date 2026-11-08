package store_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/stdlib"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// The auth and discovery tables from migrations 00002 and 00003 must come and go cleanly.
// The test rolls back all migrations, checks the tables are gone, and migrates up again.
func TestMigrationsRoundTripFromAnEmptyDatabase(t *testing.T) {
	pool := testdb.Pool(t) // already migrated to the latest version
	ctx := context.Background()
	db := stdlib.OpenDBFromPool(pool)

	for i := 0; i < 3; i++ {
		if _, err := store.RunMigrations(ctx, db, store.OpDown); err != nil {
			t.Fatalf("down step %d: %v", i+1, err)
		}
	}
	var presentUsers, presentFollows *string
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

	if _, err := store.RunMigrations(ctx, db, store.OpUp); err != nil {
		t.Fatalf("migrate up again: %v", err)
	}
	statuses, err := store.RunMigrations(ctx, db, store.OpStatus)
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if len(statuses) < 3 {
		t.Fatalf("status lists %d migrations, want at least 3", len(statuses))
	}
	for _, s := range statuses {
		if s.State != "applied" {
			t.Fatalf("migration %s state = %s, want applied", s.Source.Path, s.State)
		}
	}
}
