// Package store owns the PostgreSQL connection pool and schema migrations.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"

	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // registers the "pgx" database/sql driver for goose
	"github.com/pressly/goose/v3"

	"github.com/Cholan-kinnera/holoraa/backend/db"
)

// Open returns a connection pool. It does not connect yet. A database that is
// down at startup therefore does not stop the process; readiness reports it.
func Open(databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		// The parser error can echo the URL, so it is not wrapped.
		return nil, errors.New("database URL is malformed")
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}
	return pool, nil
}

// MigrationOp is one migration action.
type MigrationOp string

const (
	OpUp     MigrationOp = "up"
	OpDown   MigrationOp = "down"
	OpStatus MigrationOp = "status"
)

// Migrate runs op against the database at databaseURL and writes nothing to
// stdout. Callers receive status through the returned error or the result.
func Migrate(ctx context.Context, databaseURL string, op MigrationOp) ([]*goose.MigrationStatus, error) {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, errors.New("open migration connection: database URL is malformed")
	}
	defer sqlDB.Close()

	return RunMigrations(ctx, sqlDB, op)
}

// RunMigrations applies op to an open *sql.DB. Tests use it with a database
// they created themselves.
func RunMigrations(ctx context.Context, sqlDB *sql.DB, op MigrationOp) ([]*goose.MigrationStatus, error) {
	migrations, err := fs.Sub(db.Migrations, "migrations")
	if err != nil {
		return nil, fmt.Errorf("locate embedded migrations: %w", err)
	}
	// The provider does not own sqlDB, so it is not closed here. The caller
	// that opened sqlDB closes it. Closing the provider would close it too.
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations)
	if err != nil {
		return nil, fmt.Errorf("create migration provider: %w", err)
	}

	switch op {
	case OpUp:
		_, err := provider.Up(ctx)
		if err != nil {
			return nil, fmt.Errorf("migrate up: %w", err)
		}
		return nil, nil
	case OpDown:
		_, err := provider.Down(ctx)
		if err != nil {
			return nil, fmt.Errorf("migrate down: %w", err)
		}
		return nil, nil
	case OpStatus:
		statuses, err := provider.Status(ctx)
		if err != nil {
			return nil, fmt.Errorf("migration status: %w", err)
		}
		return statuses, nil
	default:
		return nil, fmt.Errorf("unknown migration operation %q", op)
	}
}
