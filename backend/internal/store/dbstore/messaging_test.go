package dbstore_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

// Helper to create two ordered users A and B (userA.ID < userB.ID).
func createOrderedUsers(t *testing.T, ctx context.Context, q *dbstore.Queries) (dbstore.User, dbstore.User) {
	t.Helper()
	u1, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatalf("create user 1: %v", err)
	}
	u2, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatalf("create user 2: %v", err)
	}
	if u1.ID < u2.ID {
		return u1, u2
	}
	return u2, u1
}

// Helper to create a valid direct conversation with exactly two members.
func createDirectConversation(t *testing.T, ctx context.Context, pool interface {
	Begin(context.Context) (pgx.Tx, error)
}, q *dbstore.Queries, convID string, userA, userB dbstore.User) dbstore.Conversation {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	txQ := q.WithTx(tx)
	conv, err := txQ.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
		ID:          convID,
		Status:      "accepted",
		UserA:       userA.ID,
		UserB:       userB.ID,
		InitiatedBy: userA.ID,
	})
	if err != nil {
		t.Fatalf("create conversation: %v", err)
	}

	if err := txQ.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
		ConversationID: conv.ID,
		UserID:         userA.ID,
	}); err != nil {
		t.Fatalf("add member A: %v", err)
	}
	if err := txQ.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
		ConversationID: conv.ID,
		UserID:         userB.ID,
	}); err != nil {
		t.Fatalf("add member B: %v", err)
	}

	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit conversation: %v", err)
	}
	return conv
}

func TestConversationCreationAndTwoMemberInvariant(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	userC, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatalf("create user C: %v", err)
	}

	convID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

	// 1. Successful conversation creation with exactly two members.
	conv := createDirectConversation(t, ctx, pool, q, convID, userA, userB)
	if conv.ID != convID || conv.Status != "accepted" {
		t.Fatalf("unexpected conversation: %+v", conv)
	}

	// 2. Deferred Trigger: Creating conversation without members fails at commit.
	t.Run("ZeroMembersFailsAtCommit", func(t *testing.T) {
		uX, uY := createOrderedUsers(t, ctx, q)
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		txQ := q.WithTx(tx)
		_, err = txQ.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
			ID:          "11111111-1111-1111-1111-111111111111",
			Status:      "pending",
			UserA:       uX.ID,
			UserB:       uY.ID,
			InitiatedBy: uX.ID,
		})
		if err != nil {
			t.Fatal(err)
		}

		err = tx.Commit(ctx)
		if err == nil {
			t.Fatal("expected deferred trigger check_violation error at commit, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("expected SQLSTATE 23514 (check_violation), got %v", err)
		}
	})

	// 3. Deferred Trigger: Creating conversation with only 1 member fails at commit.
	t.Run("OneMemberFailsAtCommit", func(t *testing.T) {
		uM, uN := createOrderedUsers(t, ctx, q)
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		txQ := q.WithTx(tx)
		cid := "22222222-2222-2222-2222-222222222222"
		_, err = txQ.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
			ID:          cid,
			Status:      "pending",
			UserA:       uM.ID,
			UserB:       uN.ID,
			InitiatedBy: uM.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := txQ.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
			ConversationID: cid,
			UserID:         uM.ID,
		}); err != nil {
			t.Fatal(err)
		}

		err = tx.Commit(ctx)
		if err == nil {
			t.Fatal("expected deferred trigger check_violation error at commit, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("expected SQLSTATE 23514 (check_violation), got %v", err)
		}
	})

	// 4. Participant Trigger: Inserting a third-party non-participant fails immediately.
	t.Run("ThirdPartyMemberFailsImmediately", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		txQ := q.WithTx(tx)
		err = txQ.CreateConversationMember(ctx, dbstore.CreateConversationMemberParams{
			ConversationID: convID,
			UserID:         userC.ID,
		})
		if err == nil {
			t.Fatal("expected check_violation error for third party member, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("expected SQLSTATE 23514, got %v", err)
		}
	})

	// 5. Independent Member Deletion Fails at Commit (DELETE trigger without NEW).
	t.Run("IndependentMemberDeletionFails", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		// Deleting a single membership while the conversation row still exists.
		// The trigger trg_enforce_mem_two_members executes on TG_OP = 'DELETE'
		// reading OLD.conversation_id without referencing NEW.
		_, err = tx.Exec(ctx, `DELETE FROM conversation_members WHERE conversation_id = $1 AND user_id = $2`, convID, userB.ID)
		if err != nil {
			t.Fatal(err)
		}

		err = tx.Commit(ctx)
		if err == nil {
			t.Fatal("expected deferred trigger check_violation error when deleting member independently, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("expected SQLSTATE 23514, got %v", err)
		}
	})

	// 6. Cascading Deletion of Conversation Succeeds.
	t.Run("CascadingDeletionOfConversationSucceeds", func(t *testing.T) {
		u1, u2 := createOrderedUsers(t, ctx, q)
		cascadeConvID := "99999999-9999-9999-9999-999999999999"
		createDirectConversation(t, ctx, pool, q, cascadeConvID, u1, u2)

		// Delete the conversation directly.
		// The foreign key constraint ON DELETE CASCADE deletes conversation_members rows.
		// trg_enforce_mem_two_members fires on DELETE for each member row, checks that
		// the parent conversation no longer exists, and allows deletion without error.
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		res, err := tx.Exec(ctx, `DELETE FROM conversations WHERE id = $1`, cascadeConvID)
		if err != nil {
			t.Fatalf("delete conversation: %v", err)
		}
		if res.RowsAffected() != 1 {
			t.Fatalf("expected 1 row affected, got %d", res.RowsAffected())
		}

		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("expected commit to succeed on cascading conversation deletion, got %v", err)
		}

		// Verify members were cascade-deleted
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM conversation_members WHERE conversation_id = $1`, cascadeConvID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected 0 members remaining, found %d", count)
		}
	})

	// 7. Cascading Deletion on User Deletion Succeeds.
	t.Run("CascadingDeletionOnUserDeletionSucceeds", func(t *testing.T) {
		u1, u2 := createOrderedUsers(t, ctx, q)
		userCascadeConvID := "88888888-8888-8888-8888-888888888888"
		createDirectConversation(t, ctx, pool, q, userCascadeConvID, u1, u2)

		// Delete user u1. This cascades to conversations, which cascades to conversation_members.
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		_, err = tx.Exec(ctx, `DELETE FROM users WHERE id = $1`, u1.ID)
		if err != nil {
			t.Fatalf("delete user: %v", err)
		}

		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("expected commit to succeed on cascading user deletion, got %v", err)
		}

		// Verify conversation and members are gone
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM conversations WHERE id = $1`, userCascadeConvID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("expected conversation to be deleted, found %d", count)
		}
	})

	// 8. Canonical Pair & Duplicate Pair Invariant.
	t.Run("CanonicalPairAndDuplicatePair", func(t *testing.T) {
		// Attempt reverse pair (userB, userA where userB > userA)
		_, err := q.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
			ID:          "33333333-3333-3333-3333-333333333333",
			Status:      "pending",
			UserA:       userB.ID,
			UserB:       userA.ID,
			InitiatedBy: userB.ID,
		})
		if err == nil {
			// LEAST/GREATEST in SQL query automatically sorts parameters,
			// but if raw insert attempts inverted order, check constraint fires:
			_, err = pool.Exec(ctx, `
				INSERT INTO conversations (id, type, status, user_a_id, user_b_id, initiated_by)
				VALUES ('44444444-4444-4444-4444-444444444444', 'direct', 'pending', $1, $2, $1)
			`, userB.ID, userA.ID)
			if err == nil {
				t.Fatal("expected check constraint violation on un-ordered user_a_id < user_b_id")
			}
		}

		// Attempt duplicate conversation for existing pair
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(ctx) }()

		txQ := q.WithTx(tx)
		_, err = txQ.CreateDirectConversation(ctx, dbstore.CreateDirectConversationParams{
			ID:          "55555555-5555-5555-5555-555555555555",
			Status:      "pending",
			UserA:       userA.ID,
			UserB:       userB.ID,
			InitiatedBy: userA.ID,
		})
		if err == nil {
			t.Fatal("expected unique violation for duplicate direct conversation pair")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			t.Fatalf("expected SQLSTATE 23505 (unique_violation), got %v", err)
		}
	})
}

func TestIdentityColumnImmutability(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	userC, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}

	convA := createDirectConversation(t, ctx, pool, q, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", userA, userB)
	var convB dbstore.Conversation
	if userA.ID < userC.ID {
		convB = createDirectConversation(t, ctx, pool, q, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", userA, userC)
	} else {
		convB = createDirectConversation(t, ctx, pool, q, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", userC, userA)
	}

	// 1. Moving member across conversations must fail (Trigger 2).
	t.Run("MoveMemberAcrossConversationsFails", func(t *testing.T) {
		_, err := pool.Exec(ctx, `
			UPDATE conversation_members
			SET conversation_id = $1
			WHERE conversation_id = $2 AND user_id = $3
		`, convB.ID, convA.ID, userB.ID)
		if err == nil {
			t.Fatal("expected immutability error when moving member across conversations, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || (pgErr.Code != "0A000" && pgErr.Code != "23514") {
			t.Fatalf("expected feature_not_supported or check_violation, got %v", err)
		}
	})

	// 2. Changing conversations.user_a_id must fail (Trigger 1).
	t.Run("UpdateConversationUserAFails", func(t *testing.T) {
		_, err := pool.Exec(ctx, `
			UPDATE conversations
			SET user_a_id = $1
			WHERE id = $2
		`, userC.ID, convA.ID)
		if err == nil {
			t.Fatal("expected immutability error on updating conversations.user_a_id")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "0A000" {
			t.Fatalf("expected SQLSTATE 0A000 (feature_not_supported), got %v", err)
		}
	})

	// 3. Changing conversations.initiated_by must fail.
	t.Run("UpdateConversationInitiatorFails", func(t *testing.T) {
		_, err := pool.Exec(ctx, `
			UPDATE conversations
			SET initiated_by = $1
			WHERE id = $2
		`, userB.ID, convA.ID)
		if err == nil {
			t.Fatal("expected immutability error on updating conversations.initiated_by")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "0A000" {
			t.Fatalf("expected SQLSTATE 0A000, got %v", err)
		}
	})

	// 4. Updating mutable columns on conversations succeeds.
	t.Run("UpdateMutableColumnsSucceeds", func(t *testing.T) {
		updated, err := q.UpdateConversationStatus(ctx, dbstore.UpdateConversationStatusParams{
			ID:     convA.ID,
			Status: "declined",
		})
		if err != nil {
			t.Fatalf("update status failed: %v", err)
		}
		if updated.Status != "declined" {
			t.Fatalf("expected status declined, got %s", updated.Status)
		}

		seq, err := q.IncrementConversationSequence(ctx, convA.ID)
		if err != nil {
			t.Fatalf("increment sequence failed: %v", err)
		}
		if seq != 1 {
			t.Fatalf("expected sequence 1, got %d", seq)
		}
	})
}

func TestSenderMembershipAndMessageIntegrity(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	userC, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}

	conv := createDirectConversation(t, ctx, pool, q, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", userA, userB)

	// 1. Non-member user C attempting to insert a message must fail foreign key constraint.
	t.Run("NonMemberMessageInsertFails", func(t *testing.T) {
		_, err := q.CreateMessage(ctx, dbstore.CreateMessageParams{
			ID:              "10000000-0000-0000-0000-000000000001",
			ConversationID:  conv.ID,
			SenderID:        userC.ID,
			ClientMessageID: "00000000-0000-0000-0000-000000000001",
			Content:         "Hello from unauthorized user",
			SequenceNum:     1,
		})
		if err == nil {
			t.Fatal("expected foreign key violation for non-member sender, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23503" {
			t.Fatalf("expected SQLSTATE 23503 (foreign_key_violation), got %v", err)
		}
	})

	// 2. Member user A inserts message successfully.
	var msg1 dbstore.Message
	t.Run("MemberMessageInsertSucceeds", func(t *testing.T) {
		seq, err := q.IncrementConversationSequence(ctx, conv.ID)
		if err != nil {
			t.Fatal(err)
		}
		msg1, err = q.CreateMessage(ctx, dbstore.CreateMessageParams{
			ID:              "10000000-0000-0000-0000-000000000002",
			ConversationID:  conv.ID,
			SenderID:        userA.ID,
			ClientMessageID: "00000000-0000-0000-0000-000000000002",
			Content:         "Hello from Alice",
			SequenceNum:     seq,
		})
		if err != nil {
			t.Fatalf("insert message: %v", err)
		}
		if msg1.SequenceNum != 1 || msg1.Content != "Hello from Alice" {
			t.Fatalf("unexpected message: %+v", msg1)
		}
	})

	// 3. Client idempotency: duplicate (conversation_id, sender_id, client_message_id).
	t.Run("DuplicateClientMessageIDFailsUnique", func(t *testing.T) {
		_, err := q.CreateMessage(ctx, dbstore.CreateMessageParams{
			ID:              "10000000-0000-0000-0000-000000000003",
			ConversationID:  conv.ID,
			SenderID:        userA.ID,
			ClientMessageID: "00000000-0000-0000-0000-000000000002", // duplicate client_message_id
			Content:         "Duplicate content",
			SequenceNum:     2,
		})
		if err == nil {
			t.Fatal("expected unique_violation for duplicate client_message_id, got nil")
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
			t.Fatalf("expected SQLSTATE 23505, got %v", err)
		}
	})

	// 4. Watermark column-specific ON DELETE SET NULL.
	t.Run("MessageDeletionSetsWatermarkNullPreservesMembership", func(t *testing.T) {
		// Set user B's last_read_message_id to msg1.ID
		_, err := pool.Exec(ctx, `
			UPDATE conversation_members
			SET last_read_message_id = $1, last_read_sequence = 1, receipt_message_id = $1, receipt_sequence = 1
			WHERE conversation_id = $2 AND user_id = $3
		`, msg1.ID, conv.ID, userB.ID)
		if err != nil {
			t.Fatalf("set watermarks: %v", err)
		}

		// Delete msg1
		_, err = pool.Exec(ctx, `DELETE FROM messages WHERE id = $1`, msg1.ID)
		if err != nil {
			t.Fatalf("delete message: %v", err)
		}

		// Member row must still exist, with last_read_message_id nullified
		memberB, err := q.GetConversationMember(ctx, dbstore.GetConversationMemberParams{
			ConversationID: conv.ID,
			UserID:         userB.ID,
		})
		if err != nil {
			t.Fatalf("get member B: %v", err)
		}
		if memberB.LastReadMessageID != nil {
			t.Fatalf("expected last_read_message_id to be NULL, got %v", *memberB.LastReadMessageID)
		}
		if memberB.ReceiptMessageID != nil {
			t.Fatalf("expected receipt_message_id to be NULL, got %v", *memberB.ReceiptMessageID)
		}
		if memberB.LastReadSequence != 1 || memberB.ReceiptSequence != 1 {
			t.Fatalf("expected sequence watermarks to remain 1, got read=%d receipt=%d",
				memberB.LastReadSequence, memberB.ReceiptSequence)
		}
	})
}

func TestSequenceInvariantCheckConstraints(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	conv := createDirectConversation(t, ctx, pool, q, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", userA, userB)

	cases := []struct {
		name string
		sql  string
	}{
		{"NegativeLastReadSequence", `UPDATE conversation_members SET last_read_sequence = -1 WHERE conversation_id = $1 AND user_id = $2`},
		{"NegativeReceiptSequence", `UPDATE conversation_members SET receipt_sequence = -1 WHERE conversation_id = $1 AND user_id = $2`},
		{"NegativeReceiptBaselineSequence", `UPDATE conversation_members SET receipt_baseline_sequence = -1 WHERE conversation_id = $1 AND user_id = $2`},
		{"ReceiptSequenceExceedsLastRead", `UPDATE conversation_members SET last_read_sequence = 5, receipt_sequence = 6 WHERE conversation_id = $1 AND user_id = $2`},
		{"ReceiptBaselineExceedsLastRead", `UPDATE conversation_members SET last_read_sequence = 5, receipt_baseline_sequence = 6 WHERE conversation_id = $1 AND user_id = $2`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, tc.sql, conv.ID, userA.ID)
			if err == nil {
				t.Fatalf("expected check_violation for %s, got nil", tc.name)
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("expected SQLSTATE 23514 (check_violation), got %v", err)
			}
		})
	}
}

func TestSettingsTransitionSeparateStatements(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	conv := createDirectConversation(t, ctx, pool, q, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", userA, userB)

	// Helper for setting transition using separate SQL statements inside one transaction
	toggleSetting := func(userID string, enabled bool) error {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()

		txQ := q.WithTx(tx)

		// Statement 1: safe upsert default
		if err := txQ.UpsertDefaultUserSettings(ctx, userID); err != nil {
			return fmt.Errorf("upsert default: %w", err)
		}

		// Statement 2: lock settings row and capture previous setting
		prev, err := txQ.GetUserSettingsForUpdate(ctx, userID)
		if err != nil {
			return fmt.Errorf("lock user_settings: %w", err)
		}

		// Statement 3: update user_settings
		if _, err := txQ.UpdateUserSettings(ctx, dbstore.UpdateUserSettingsParams{
			UserID:              userID,
			ReadReceiptsEnabled: enabled,
		}); err != nil {
			return fmt.Errorf("update user_settings: %w", err)
		}

		// Statement 4: separate statement executed ONLY IF previous was false and requested is true
		if !prev.ReadReceiptsEnabled && enabled {
			if err := txQ.PinConversationMembersBaseline(ctx, userID); err != nil {
				return fmt.Errorf("pin baseline: %w", err)
			}
		}

		return tx.Commit(ctx)
	}

	// 1. Initial State: Read receipts enabled by default.
	// Disable receipts for User B.
	if err := toggleSetting(userB.ID, false); err != nil {
		t.Fatalf("disable receipts: %v", err)
	}

	// Advance user B's private read watermark to 10.
	_, err := pool.Exec(ctx, `
		UPDATE conversation_members
		SET last_read_sequence = 10, receipt_sequence = 0, receipt_baseline_sequence = 0
		WHERE conversation_id = $1 AND user_id = $2
	`, conv.ID, userB.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Scenario A: Fresh Statement Snapshot on False-to-True Re-enable.
	t.Run("ScenarioA_FreshStatementSnapshot", func(t *testing.T) {
		var wg sync.WaitGroup
		wg.Add(2)

		var s1Err, s2Err error

		// Session 1: advances last_read_sequence to 20 while holding user_settings lock
		go func() {
			defer wg.Done()
			tx1, err := pool.Begin(ctx)
			if err != nil {
				s1Err = err
				return
			}
			defer func() { _ = tx1.Rollback(ctx) }()

			// Lock L1
			var dummy bool
			if err := tx1.QueryRow(ctx, `SELECT read_receipts_enabled FROM user_settings WHERE user_id = $1 FOR UPDATE`, userB.ID).Scan(&dummy); err != nil {
				s1Err = err
				return
			}

			// Advance last_read_sequence to 20
			if _, err := tx1.Exec(ctx, `UPDATE conversation_members SET last_read_sequence = 20 WHERE conversation_id = $1 AND user_id = $2`, conv.ID, userB.ID); err != nil {
				s1Err = err
				return
			}

			time.Sleep(500 * time.Millisecond)
			s1Err = tx1.Commit(ctx)
		}()

		// Session 2: attempts re-enable, blocks on Session 1, then executes Statement 4
		go func() {
			defer wg.Done()
			time.Sleep(150 * time.Millisecond) // Ensure Session 1 acquires lock first
			s2Err = toggleSetting(userB.ID, true)
		}()

		wg.Wait()
		if s1Err != nil {
			t.Fatalf("session 1 failed: %v", s1Err)
		}
		if s2Err != nil {
			t.Fatalf("session 2 failed: %v", s2Err)
		}

		// Verify receipt_baseline_sequence equals 20 (newly committed value)
		memberB, err := q.GetConversationMember(ctx, dbstore.GetConversationMemberParams{
			ConversationID: conv.ID,
			UserID:         userB.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if memberB.ReceiptBaselineSequence != 20 {
			t.Fatalf("expected baseline sequence 20, got %d", memberB.ReceiptBaselineSequence)
		}
	})

	// Repeated toggle with enabled = true does NOT reset baseline.
	t.Run("RepeatedEnableDoesNotResetBaseline", func(t *testing.T) {
		// Advance last_read_sequence to 25
		_, err := pool.Exec(ctx, `
			UPDATE conversation_members
			SET last_read_sequence = 25
			WHERE conversation_id = $1 AND user_id = $2
		`, conv.ID, userB.ID)
		if err != nil {
			t.Fatal(err)
		}

		// Re-send enable = true (repeated toggle)
		if err := toggleSetting(userB.ID, true); err != nil {
			t.Fatalf("repeated toggle failed: %v", err)
		}

		// Baseline must remain 20
		memberB, err := q.GetConversationMember(ctx, dbstore.GetConversationMemberParams{
			ConversationID: conv.ID,
			UserID:         userB.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		if memberB.ReceiptBaselineSequence != 20 {
			t.Fatalf("expected baseline to remain 20, got %d", memberB.ReceiptBaselineSequence)
		}
	})
}

func TestOutboxLeaseClaimingAndSplitBrainPrevention(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	userA, userB := createOrderedUsers(t, ctx, q)
	conv := createDirectConversation(t, ctx, pool, q, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", userA, userB)

	// 1. Insert outbox event
	event, err := q.InsertOutboxEvent(ctx, dbstore.InsertOutboxEventParams{
		EventType:      "message.created",
		ConversationID: conv.ID,
		Payload:        []byte(`{"text":"hello"}`),
		TargetUserIds:  []string{userB.ID},
	})
	if err != nil {
		t.Fatalf("insert outbox event: %v", err)
	}
	if event.Status != "pending" {
		t.Fatalf("expected status pending, got %s", event.Status)
	}

	// 2. Claim event with lease
	worker1 := "worker-node-1"
	claimed, err := q.ClaimOutboxBatchWithLease(ctx, dbstore.ClaimOutboxBatchWithLeaseParams{
		WorkerID:  worker1,
		BatchSize: 10,
	})
	if err != nil {
		t.Fatalf("claim outbox batch: %v", err)
	}
	if len(claimed) != 1 || claimed[0].ID != event.ID {
		t.Fatalf("expected 1 claimed event with ID %d, got %+v", event.ID, claimed)
	}
	claimToken := claimed[0].ClaimToken
	if claimToken == nil || *claimToken == "" {
		t.Fatalf("expected non-empty claim_token, got %v", claimToken)
	}

	// 3. Stale Worker / Expired Lease Rejection
	// Force lease expiration
	_, err = pool.Exec(ctx, `UPDATE outbox_events SET lease_expires_at = now() - interval '5 seconds' WHERE id = $1`, event.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Worker 1 attempts to mark published after lease expiration: must affect 0 rows
	rows, err := q.MarkOutboxPublished(ctx, dbstore.MarkOutboxPublishedParams{
		ID:         event.ID,
		WorkerID:   worker1,
		ClaimToken: *claimToken,
	})
	if err != nil {
		t.Fatalf("mark outbox published: %v", err)
	}
	if rows != 0 {
		t.Fatalf("expected 0 rows affected for expired lease, got %d", rows)
	}
}

func TestWebSocketTicketLifecycle(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()
	q := dbstore.New(pool)

	user, err := q.CreateUser(ctx)
	if err != nil {
		t.Fatal(err)
	}

	hash := sha256.Sum256([]byte("valid-random-ticket-secret"))

	// 1. Create ticket expiring in 60 seconds
	expiresAt := time.Now().Add(60 * time.Second)
	err = q.CreateWSTicket(ctx, dbstore.CreateWSTicketParams{
		TicketHash: hash[:],
		UserID:     user.ID,
		ExpiresAt:  pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		t.Fatalf("create ticket: %v", err)
	}

	// 2. Consume ticket (single-use)
	consumedUser, err := q.ConsumeWSTicket(ctx, hash[:])
	if err != nil {
		t.Fatalf("consume ticket: %v", err)
	}
	if consumedUser != user.ID {
		t.Fatalf("expected user ID %s, got %s", user.ID, consumedUser)
	}

	// 3. Second consume attempt must fail (already deleted)
	_, err = q.ConsumeWSTicket(ctx, hash[:])
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected ErrNoRows on duplicate ticket consumption, got %v", err)
	}
}
