package dbstore_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

func TestUserAndIdentityQueries(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	queries := dbstore.New(pool)

	// 1. Create a user.
	user, err := queries.CreateUser(ctx)
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if user.ID == "" {
		t.Fatalf("expected non-empty user ID")
	}

	// 2. Retrieve user by ID.
	foundUser, err := queries.GetUserByID(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if foundUser.ID != user.ID {
		t.Fatalf("user ID mismatch: got %q, want %q", foundUser.ID, user.ID)
	}

	// 3. Create an email identity.
	email := "representative@example.test"
	ident, err := queries.CreateEmailIdentity(ctx, dbstore.CreateEmailIdentityParams{
		Email:  email,
		UserID: user.ID,
	})
	if err != nil {
		t.Fatalf("CreateEmailIdentity failed: %v", err)
	}
	if ident.Email != email || ident.UserID != user.ID {
		t.Fatalf("identity mismatch: got %+v", ident)
	}

	// 4. Retrieve email identity by email.
	foundIdent, err := queries.GetEmailIdentityByEmail(ctx, email)
	if err != nil {
		t.Fatalf("GetEmailIdentityByEmail failed: %v", err)
	}
	if foundIdent.Email != email || foundIdent.UserID != user.ID {
		t.Fatalf("found identity mismatch: got %+v", foundIdent)
	}

	// 5. GetProfileMe with joined email.
	me, err := queries.GetProfileMe(ctx, user.ID)
	if err != nil {
		t.Fatalf("GetProfileMe failed: %v", err)
	}
	if me.ID != user.ID || me.Email != email {
		t.Fatalf("profile me mismatch: got ID=%q Email=%q, want ID=%q Email=%q", me.ID, me.Email, user.ID, email)
	}
}

func TestWithTxRollback(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	queries := dbstore.New(pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	txQueries := queries.WithTx(tx)
	user, err := txQueries.CreateUser(ctx)
	if err != nil {
		t.Fatalf("tx CreateUser failed: %v", err)
	}

	// Rollback the transaction.
	if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	// Verifying with non-tx queries: user must not exist.
	_, err = queries.GetUserByID(ctx, user.ID)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected ErrNoRows after rollback, got %v", err)
	}
}

func TestContextCancellation(t *testing.T) {
	pool := testdb.Pool(t)
	queries := dbstore.New(pool)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel context immediately before calling query

	_, err := queries.CreateUser(ctx)
	if err == nil {
		t.Fatalf("expected error on canceled context, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled error, got %v", err)
	}
}
