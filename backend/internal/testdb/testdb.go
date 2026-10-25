// Package testdb gives tests a fresh, migrated PostgreSQL database. It is used
// only by tests. The production binary never imports it.
//
// Tests need an admin connection to the development server, read from
// HOLORAA_TEST_DATABASE_URL (make test-db sets it). Without it the test is
// skipped and the skip is reported. Each test gets its own scratch database,
// which is dropped when the test ends.
package testdb

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store"
)

// Env is the environment variable that holds the admin URL.
const Env = "HOLORAA_TEST_DATABASE_URL"

// Pool creates a migrated scratch database and returns a pool connected to it.
// It skips the test when Env is unset.
func Pool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	admin := os.Getenv(Env)
	if admin == "" {
		t.Skipf("%s is not set; run make test-db", Env)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	name, scratchURL := createScratch(ctx, t, admin)
	// Cleanups run last-in first-out: the pool closes before the database is dropped.
	t.Cleanup(func() { dropScratch(admin, name) })

	sqlDB, err := sql.Open("pgx", scratchURL)
	if err != nil {
		t.Fatalf("open migration connection: %v", err)
	}
	if _, err := store.RunMigrations(ctx, sqlDB, store.OpUp); err != nil {
		_ = sqlDB.Close()
		t.Fatalf("migrate scratch database: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close migration connection: %v", err)
	}

	pool, err := pgxpool.New(ctx, scratchURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func createScratch(ctx context.Context, t *testing.T, admin string) (string, string) {
	t.Helper()
	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatalf("random suffix: %v", err)
	}
	name := "holoraa_test_" + hex.EncodeToString(suffix)

	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connect as admin: %v", err)
	}
	defer conn.Close(ctx)
	if _, err := conn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", pgx.Identifier{name}.Sanitize())); err != nil {
		t.Fatalf("create scratch database: %v", err)
	}

	u, err := url.Parse(admin)
	if err != nil {
		t.Fatalf("parse admin URL: %v", err)
	}
	u.Path = "/" + name
	return name, u.String()
}

func dropScratch(admin, name string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		return
	}
	defer conn.Close(ctx)
	_, _ = conn.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", pgx.Identifier{name}.Sanitize()))
}
