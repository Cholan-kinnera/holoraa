package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// testAdminURL points at a PostgreSQL server where the test may create and
// drop its own databases. It comes from the environment, never from this file.
const testAdminEnv = "HOLORAA_TEST_DATABASE_URL"

func requireAdminURL(t *testing.T) string {
	t.Helper()
	u := os.Getenv(testAdminEnv)
	if u == "" {
		t.Skipf("%s is not set; run make test-db", testAdminEnv)
	}
	return u
}

// createScratchDatabase creates a uniquely named empty database and returns
// its URL. The caller must drop it with dropScratchDatabase.
func createScratchDatabase(t *testing.T, adminURL string) (name, scratchURL string) {
	t.Helper()

	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		t.Fatalf("random suffix: %v", err)
	}
	name = "holoraa_test_" + hex.EncodeToString(suffix)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("connect as admin: %v", err)
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s", pgx.Identifier{name}.Sanitize())); err != nil {
		t.Fatalf("create scratch database: %v", err)
	}

	u, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("parse admin URL: %v", err)
	}
	u.Path = "/" + name
	return name, u.String()
}

func dropScratchDatabase(t *testing.T, adminURL, name string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Errorf("connect as admin to drop %s: %v", name, err)
		return
	}
	defer conn.Close(ctx)

	if _, err := conn.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", pgx.Identifier{name}.Sanitize())); err != nil {
		t.Errorf("drop scratch database %s: %v", name, err)
	}
}

// TestIntegrationMigrationRoundTrip proves that migrations apply from an empty
// database, roll back, and apply again, and that status is clean at the end.
func TestIntegrationMigrationRoundTrip(t *testing.T) {
	adminURL := requireAdminURL(t)
	name, scratchURL := createScratchDatabase(t, adminURL)
	defer dropScratchDatabase(t, adminURL, name)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	sqlDB, err := sql.Open("pgx", scratchURL)
	if err != nil {
		t.Fatalf("open scratch database: %v", err)
	}
	defer sqlDB.Close()

	if _, err := RunMigrations(ctx, sqlDB, OpUp); err != nil {
		t.Fatalf("migrate up from empty: %v", err)
	}
	if _, err := RunMigrations(ctx, sqlDB, OpDown); err != nil {
		t.Fatalf("migrate down: %v", err)
	}
	if _, err := RunMigrations(ctx, sqlDB, OpUp); err != nil {
		t.Fatalf("migrate up after down: %v", err)
	}

	statuses, err := RunMigrations(ctx, sqlDB, OpStatus)
	if err != nil {
		t.Fatalf("migrate status: %v", err)
	}
	if len(statuses) == 0 {
		t.Fatal("status lists no migrations; the embedded files were not found")
	}
	for _, s := range statuses {
		if s.State != "applied" {
			t.Fatalf("migration %s state = %q after round trip, want applied", s.Source.Path, s.State)
		}
	}
}

// TestIntegrationOpenUsesRealPool checks that a pool built from the test URL
// can reach the server. It is the connection path readiness uses.
func TestIntegrationOpenUsesRealPool(t *testing.T) {
	adminURL := requireAdminURL(t)

	pool, err := Open(adminURL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping real database: %v", err)
	}
}

func TestOpenRejectsMalformedURLWithoutEchoingIt(t *testing.T) {
	const secret = "pw-should-not-appear"
	_, err := Open("postgres://u:" + secret + "@[::1")
	if err == nil {
		t.Fatal("expected an error for a malformed URL")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("error echoes the URL: %q", err.Error())
	}
}
