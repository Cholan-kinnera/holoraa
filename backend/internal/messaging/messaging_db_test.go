package messaging_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

func createTestUser(t testing.TB, pool *pgxpool.Pool, username string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		"INSERT INTO users (username, display_name) VALUES ($1, $2) RETURNING id",
		username, username,
	).Scan(&id)
	if err != nil {
		t.Fatalf("insert test user %s: %v", username, err)
	}
	return id
}

func followUser(t testing.TB, pool *pgxpool.Pool, followerID, followingID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		"INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		followerID, followingID,
	)
	if err != nil {
		t.Fatalf("follow user: %v", err)
	}
}

func TestDirectConversationLifecycle(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_cycle")
	bob := createTestUser(t, pool, "bob_cycle")
	carol := createTestUser(t, pool, "carol_cycle")

	// 1. Non-mutual follow -> pending conversation
	conv1, created, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_cycle")
	if err != nil {
		t.Fatalf("create conv alice-bob: %v", err)
	}
	if !created {
		t.Fatalf("expected created=true for new conversation")
	}
	if conv1.Status != "pending" {
		t.Fatalf("expected status=pending, got %s", conv1.Status)
	}

	// 2. Idempotent retrieval
	conv1Again, createdAgain, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_cycle")
	if err != nil {
		t.Fatalf("get conv alice-bob: %v", err)
	}
	if createdAgain {
		t.Fatalf("expected created=false for existing conversation")
	}
	if conv1Again.ID != conv1.ID {
		t.Fatalf("expected matching conv ID, got %s vs %s", conv1Again.ID, conv1.ID)
	}

	// 3. Peer can also retrieve same conversation
	convFromBob, createdFromBob, err := svc.GetOrCreateDirectConversation(ctx, bob, "alice_cycle")
	if err != nil {
		t.Fatalf("bob get conv: %v", err)
	}
	if createdFromBob {
		t.Fatalf("bob should not create duplicate conversation")
	}
	if convFromBob.ID != conv1.ID {
		t.Fatalf("bob got different conv ID: %s vs %s", convFromBob.ID, conv1.ID)
	}

	// 4. Mutual follow -> auto-accepted
	followUser(t, pool, alice, carol)
	followUser(t, pool, carol, alice)
	conv2, created2, err := svc.GetOrCreateDirectConversation(ctx, alice, "carol_cycle")
	if err != nil {
		t.Fatalf("create conv alice-carol: %v", err)
	}
	if !created2 {
		t.Fatalf("expected created=true")
	}
	if conv2.Status != "accepted" {
		t.Fatalf("expected status=accepted for mutual follow, got %s", conv2.Status)
	}

	// 5. Self-conversation rejected
	_, _, err = svc.GetOrCreateDirectConversation(ctx, alice, "alice_cycle")
	if !errors.Is(err, messaging.ErrSelfConversation) {
		t.Fatalf("expected ErrSelfConversation, got %v", err)
	}

	// 6. Unknown user rejected
	_, _, err = svc.GetOrCreateDirectConversation(ctx, alice, "nonexistent_user")
	if !errors.Is(err, messaging.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

func TestConversationAcceptDecline(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_acc")
	bob := createTestUser(t, pool, "bob_acc")

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_acc")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	// Initiator sends 1 message in pending request
	clientMsg1 := messaging.NewUUID()
	msg1, err := svc.SendMessage(ctx, alice, conv.ID, clientMsg1, "Hello Bob!")
	if err != nil {
		t.Fatalf("send message 1: %v", err)
	}
	if msg1.SequenceNum != 1 {
		t.Fatalf("expected sequence 1, got %d", msg1.SequenceNum)
	}

	// Initiator sending 2nd message fails
	clientMsg2 := messaging.NewUUID()
	_, err = svc.SendMessage(ctx, alice, conv.ID, clientMsg2, "Hello again Bob!")
	if !errors.Is(err, messaging.ErrPendingLimit) {
		t.Fatalf("expected ErrPendingLimit, got %v", err)
	}

	// Recipient replying in pending state fails
	clientMsgBob := messaging.NewUUID()
	_, err = svc.SendMessage(ctx, bob, conv.ID, clientMsgBob, "Hi Alice!")
	if !errors.Is(err, messaging.ErrPendingRecipient) {
		t.Fatalf("expected ErrPendingRecipient, got %v", err)
	}

	// Initiator cannot accept their own request
	_, err = svc.AcceptConversation(ctx, alice, conv.ID)
	if !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for initiator accepting, got %v", err)
	}

	// Recipient accepts request
	acceptedConv, err := svc.AcceptConversation(ctx, bob, conv.ID)
	if err != nil {
		t.Fatalf("bob accept: %v", err)
	}
	if acceptedConv.Status != "accepted" {
		t.Fatalf("expected accepted status, got %s", acceptedConv.Status)
	}

	// Now recipient can reply
	replyMsg, err := svc.SendMessage(ctx, bob, conv.ID, clientMsgBob, "Hi Alice, accepted!")
	if err != nil {
		t.Fatalf("bob reply after accept: %v", err)
	}
	if replyMsg.SequenceNum != 2 {
		t.Fatalf("expected sequence 2, got %d", replyMsg.SequenceNum)
	}

	// And alice can send more messages
	msg3, err := svc.SendMessage(ctx, alice, conv.ID, clientMsg2, "Awesome!")
	if err != nil {
		t.Fatalf("alice send after accept: %v", err)
	}
	if msg3.SequenceNum != 3 {
		t.Fatalf("expected sequence 3, got %d", msg3.SequenceNum)
	}

	// Test Decline flow in a separate conversation
	carol := createTestUser(t, pool, "carol_dec")
	convCarol, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "carol_dec")
	if err != nil {
		t.Fatalf("create conv with carol: %v", err)
	}

	// Initiator cannot decline
	_, err = svc.DeclineConversation(ctx, alice, convCarol.ID)
	if !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("expected ErrForbidden for initiator declining, got %v", err)
	}

	// Carol declines
	declinedConv, err := svc.DeclineConversation(ctx, carol, convCarol.ID)
	if err != nil {
		t.Fatalf("carol decline: %v", err)
	}
	if declinedConv.Status != "declined" {
		t.Fatalf("expected declined, got %s", declinedConv.Status)
	}

	// Sends in declined conversation are rejected
	_, err = svc.SendMessage(ctx, alice, convCarol.ID, messaging.NewUUID(), "Are you there?")
	if !errors.Is(err, messaging.ErrDeclined) {
		t.Fatalf("expected ErrDeclined, got %v", err)
	}
}

func TestBlockingLifecycle(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_block")
	bob := createTestUser(t, pool, "bob_block")

	// Block user
	if err := svc.BlockUser(ctx, alice, "bob_block"); err != nil {
		t.Fatalf("alice block bob: %v", err)
	}

	// Creating conversation while blocked fails
	_, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_block")
	if !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("expected ErrBlocked, got %v", err)
	}
	_, _, err = svc.GetOrCreateDirectConversation(ctx, bob, "alice_block")
	if !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("expected ErrBlocked, got %v", err)
	}

	// Unblock
	if err := svc.UnblockUser(ctx, alice, "bob_block"); err != nil {
		t.Fatalf("alice unblock bob: %v", err)
	}

	// Create conversation succeeds
	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_block")
	if err != nil {
		t.Fatalf("create conv after unblock: %v", err)
	}

	// Block again
	if err := svc.BlockUser(ctx, bob, "alice_block"); err != nil {
		t.Fatalf("bob block alice: %v", err)
	}

	// Sending message while blocked fails
	_, err = svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Hello")
	if !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("expected ErrBlocked on send, got %v", err)
	}

	// Self-block rejected
	err = svc.BlockUser(ctx, alice, "alice_block")
	if !errors.Is(err, messaging.ErrSelfBlock) {
		t.Fatalf("expected ErrSelfBlock, got %v", err)
	}
}

func TestMessageOrderingAndIdempotency(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_msg")
	bob := createTestUser(t, pool, "bob_msg")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_msg")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	clientMsgID := messaging.NewUUID()
	msg1, err := svc.SendMessage(ctx, alice, conv.ID, clientMsgID, "Idempotent test message")
	if err != nil {
		t.Fatalf("send message: %v", err)
	}
	if msg1.SequenceNum != 1 {
		t.Fatalf("expected seq 1, got %d", msg1.SequenceNum)
	}

	// Send duplicate with same client_message_id
	msg1Retry, err := svc.SendMessage(ctx, alice, conv.ID, clientMsgID, "Idempotent test message")
	if err != nil {
		t.Fatalf("send duplicate message: %v", err)
	}
	if msg1Retry.ID != msg1.ID || msg1Retry.SequenceNum != msg1.SequenceNum {
		t.Fatalf("idempotent retry mismatch: got ID=%s Seq=%d", msg1Retry.ID, msg1Retry.SequenceNum)
	}

	// Verify only 1 message exists in database
	var count int
	err = pool.QueryRow(ctx, "SELECT count(*) FROM messages WHERE conversation_id = $1", conv.ID).Scan(&count)
	if err != nil || count != 1 {
		t.Fatalf("expected count 1, got %d (err: %v)", count, err)
	}

	// Verify outbox event was recorded
	var outboxCount int
	err = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND event_type = 'message.created'", conv.ID).Scan(&outboxCount)
	if err != nil || outboxCount != 1 {
		t.Fatalf("expected outbox event count 1, got %d (err: %v)", outboxCount, err)
	}
}

func TestKeysetPagination(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_page")
	bob := createTestUser(t, pool, "bob_page")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_page")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	msgIDs := make([]string, 10)
	for i := 0; i < 10; i++ {
		msg, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), fmt.Sprintf("Message %d", i+1))
		if err != nil {
			t.Fatalf("send message %d: %v", i+1, err)
		}
		msgIDs[i] = msg.ID
	}

	// 1. Latest messages (limit 4)
	pageLatest, err := svc.ListMessages(ctx, alice, conv.ID, "", "", 4)
	if err != nil {
		t.Fatalf("list latest: %v", err)
	}
	if len(pageLatest.Messages) != 4 || !pageLatest.HasMore {
		t.Fatalf("expected 4 messages and hasMore=true, got %d, %v", len(pageLatest.Messages), pageLatest.HasMore)
	}
	if pageLatest.Messages[0].SequenceNum != 10 {
		t.Fatalf("expected latest message seq 10, got %d", pageLatest.Messages[0].SequenceNum)
	}

	// 2. Before cursor (messages older than message 8)
	pageBefore, err := svc.ListMessages(ctx, alice, conv.ID, msgIDs[7], "", 3) // msgIDs[7] is seq 8
	if err != nil {
		t.Fatalf("list before: %v", err)
	}
	if len(pageBefore.Messages) != 3 || !pageBefore.HasMore {
		t.Fatalf("expected 3 messages, got %d", len(pageBefore.Messages))
	}
	if pageBefore.Messages[0].SequenceNum != 7 {
		t.Fatalf("expected first message seq 7, got %d", pageBefore.Messages[0].SequenceNum)
	}

	// 3. After cursor (messages newer than message 3, oldest first)
	pageAfter, err := svc.ListMessages(ctx, alice, conv.ID, "", msgIDs[2], 3) // msgIDs[2] is seq 3
	if err != nil {
		t.Fatalf("list after: %v", err)
	}
	if len(pageAfter.Messages) != 3 || !pageAfter.HasMore {
		t.Fatalf("expected 3 messages, got %d", len(pageAfter.Messages))
	}
	if pageAfter.Messages[0].SequenceNum != 4 {
		t.Fatalf("expected seq 4, got %d", pageAfter.Messages[0].SequenceNum)
	}

	// 4. Soft-deleted message handling
	// Soft delete message 5 (msgIDs[4])
	_, err = pool.Exec(ctx, "UPDATE messages SET deleted_at = now() WHERE id = $1", msgIDs[4])
	if err != nil {
		t.Fatalf("soft delete message: %v", err)
	}

	// Message 5 still acts as valid cursor
	pageSoftCursor, err := svc.ListMessages(ctx, alice, conv.ID, msgIDs[4], "", 5)
	if err != nil {
		t.Fatalf("list before soft-deleted message: %v", err)
	}
	if pageSoftCursor.Messages[0].SequenceNum != 4 {
		t.Fatalf("expected seq 4 right before deleted seq 5, got %d", pageSoftCursor.Messages[0].SequenceNum)
	}

	// 5. Invalid cursor rejected
	_, err = svc.ListMessages(ctx, alice, conv.ID, messaging.NewUUID(), "", 10)
	if !errors.Is(err, messaging.ErrInvalidCursor) {
		t.Fatalf("expected ErrInvalidCursor, got %v", err)
	}

	// 6. Conflicting cursors rejected
	_, err = svc.ListMessages(ctx, alice, conv.ID, msgIDs[5], msgIDs[2], 10)
	if !errors.Is(err, messaging.ErrInvalidCursorCombo) {
		t.Fatalf("expected ErrInvalidCursorCombo, got %v", err)
	}
}

func TestDualReadWatermarksAndPrivacyReceipts(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_receipt")
	bob := createTestUser(t, pool, "bob_receipt")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_receipt")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	// Alice sends 3 messages
	m1, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 1")
	m2, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 2")
	m3, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 3")

	// 1. Alice viewing her own messages does not advance receipt_sequence and emits 0 outbox events
	if err := svc.MarkRead(ctx, alice, conv.ID, m3.ID); err != nil {
		t.Fatalf("alice mark read own messages: %v", err)
	}
	var aliceMem struct {
		LastReadSeq int64
		ReceiptSeq  int64
	}
	err = pool.QueryRow(ctx, "SELECT last_read_sequence, receipt_sequence FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", conv.ID, alice).
		Scan(&aliceMem.LastReadSeq, &aliceMem.ReceiptSeq)
	if err != nil {
		t.Fatalf("read alice member: %v", err)
	}
	if aliceMem.LastReadSeq != 3 || aliceMem.ReceiptSeq != 0 {
		t.Fatalf("expected alice last_read=3, receipt=0, got %d, %d", aliceMem.LastReadSeq, aliceMem.ReceiptSeq)
	}
	var readEventCount int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE event_type = 'message.read'").Scan(&readEventCount)
	if readEventCount != 0 {
		t.Fatalf("expected 0 read outbox events when viewing own messages, got %d", readEventCount)
	}

	// 2. Bob reads up to message 2 with receipts enabled (default is true)
	if err := svc.MarkRead(ctx, bob, conv.ID, m2.ID); err != nil {
		t.Fatalf("bob mark read: %v", err)
	}
	var bobMem struct {
		LastReadSeq int64
		ReceiptSeq  int64
	}
	err = pool.QueryRow(ctx, "SELECT last_read_sequence, receipt_sequence FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", conv.ID, bob).
		Scan(&bobMem.LastReadSeq, &bobMem.ReceiptSeq)
	if err != nil {
		t.Fatalf("read bob member: %v", err)
	}
	if bobMem.LastReadSeq != 2 || bobMem.ReceiptSeq != 2 {
		t.Fatalf("expected bob last_read=2, receipt=2, got %d, %d", bobMem.LastReadSeq, bobMem.ReceiptSeq)
	}

	// Verify message 1 and 2 have read_at populated, message 3 is null
	var m1Read, m2Read, m3Read bool
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m1.ID).Scan(&m1Read)
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m2.ID).Scan(&m2Read)
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m3.ID).Scan(&m3Read)
	if !m1Read || !m2Read || m3Read {
		t.Fatalf("unexpected read_at states: m1=%v m2=%v m3=%v", m1Read, m2Read, m3Read)
	}

	// 3. Bob disables read receipts
	_, err = svc.UpdateSettings(ctx, bob, false)
	if err != nil {
		t.Fatalf("bob disable receipts: %v", err)
	}

	// Alice sends message 4 and 5
	m4, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 4")
	m5, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 5")

	// Bob reads up to message 5 while disabled
	if err := svc.MarkRead(ctx, bob, conv.ID, m5.ID); err != nil {
		t.Fatalf("bob read m5 disabled: %v", err)
	}
	_ = pool.QueryRow(ctx, "SELECT last_read_sequence, receipt_sequence FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", conv.ID, bob).
		Scan(&bobMem.LastReadSeq, &bobMem.ReceiptSeq)
	if bobMem.LastReadSeq != 5 || bobMem.ReceiptSeq != 2 {
		t.Fatalf("expected private watermark 5, frozen receipt watermark 2, got %d, %d", bobMem.LastReadSeq, bobMem.ReceiptSeq)
	}

	// Messages 4 and 5 must have read_at = NULL
	var m4Read, m5Read bool
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m4.ID).Scan(&m4Read)
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m5.ID).Scan(&m5Read)
	if m4Read || m5Read {
		t.Fatalf("messages read during disabled period must NOT have read_at set")
	}

	// 4. Bob re-enables read receipts (pins baseline to last_read_sequence = 5)
	_, err = svc.UpdateSettings(ctx, bob, true)
	if err != nil {
		t.Fatalf("bob re-enable receipts: %v", err)
	}
	var baselineSeq int64
	_ = pool.QueryRow(ctx, "SELECT receipt_baseline_sequence FROM conversation_members WHERE conversation_id = $1 AND user_id = $2", conv.ID, bob).
		Scan(&baselineSeq)
	if baselineSeq != 5 {
		t.Fatalf("expected pinned baseline 5, got %d", baselineSeq)
	}

	// Alice sends message 6
	m6, _ := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 6")

	// Bob reads message 6
	if err := svc.MarkRead(ctx, bob, conv.ID, m6.ID); err != nil {
		t.Fatalf("bob read m6: %v", err)
	}

	// Message 6 is marked read, but messages 4 and 5 remain NOT read (zero retroactive disclosure!)
	var m6Read bool
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m4.ID).Scan(&m4Read)
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m5.ID).Scan(&m5Read)
	_ = pool.QueryRow(ctx, "SELECT read_at IS NOT NULL FROM messages WHERE id = $1", m6.ID).Scan(&m6Read)
	if m4Read || m5Read || !m6Read {
		t.Fatalf("retroactive disclosure violated! m4=%v, m5=%v, m6=%v", m4Read, m5Read, m6Read)
	}
}

func TestDeliveryReceipts(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_deliv")
	bob := createTestUser(t, pool, "bob_deliv")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_deliv")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	msg, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Test delivery")
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	// Sender cannot acknowledge delivery of their own message
	if err := svc.MarkDelivered(ctx, alice, conv.ID, msg.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("alice mark delivered own msg: got %v, want ErrForbidden", err)
	}
	var delivered bool
	_ = pool.QueryRow(ctx, "SELECT delivered_at IS NOT NULL FROM messages WHERE id = $1", msg.ID).Scan(&delivered)
	if delivered {
		t.Fatalf("sender marking own message should not set delivered_at")
	}

	// Recipient marks delivered
	if err := svc.MarkDelivered(ctx, bob, conv.ID, msg.ID); err != nil {
		t.Fatalf("bob mark delivered: %v", err)
	}
	_ = pool.QueryRow(ctx, "SELECT delivered_at IS NOT NULL FROM messages WHERE id = $1", msg.ID).Scan(&delivered)
	if !delivered {
		t.Fatalf("expected delivered_at to be set")
	}

	// Idempotent retry produces no duplicate outbox events
	if err := svc.MarkDelivered(ctx, bob, conv.ID, msg.ID); err != nil {
		t.Fatalf("bob mark delivered retry: %v", err)
	}
	var delivEvents int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE event_type = 'message.delivered'").Scan(&delivEvents)
	if delivEvents != 1 {
		t.Fatalf("expected exactly 1 delivered outbox event, got %d", delivEvents)
	}
}

func TestConcurrentMessageSends(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_conc")
	bob := createTestUser(t, pool, "bob_conc")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_conc")
	if err != nil {
		t.Fatalf("create conv: %v", err)
	}

	const goroutines = 10
	var wg sync.WaitGroup
	errCh := make(chan error, goroutines)
	seqCh := make(chan int64, goroutines)

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sender := alice
			if idx%2 == 1 {
				sender = bob
			}
			msg, err := svc.SendMessage(ctx, sender, conv.ID, messaging.NewUUID(), fmt.Sprintf("Concurrent %d", idx))
			if err != nil {
				errCh <- err
				return
			}
			seqCh <- msg.SequenceNum
		}(i)
	}

	wg.Wait()
	close(errCh)
	close(seqCh)

	for err := range errCh {
		t.Fatalf("concurrent send failed: %v", err)
	}

	seen := make(map[int64]bool)
	for seq := range seqCh {
		if seen[seq] {
			t.Fatalf("duplicate sequence number: %d", seq)
		}
		seen[seq] = true
	}

	if len(seen) != goroutines {
		t.Fatalf("expected %d distinct sequence numbers, got %d", goroutines, len(seen))
	}

	for i := int64(1); i <= goroutines; i++ {
		if !seen[i] {
			t.Fatalf("missing sequence number %d (gap in sequence allocation)", i)
		}
	}
}

func TestAuditPendingMessageIdempotency(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_pend_idem")
	_ = createTestUser(t, pool, "bob_pend_idem")

	conv, created, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_pend_idem")
	if err != nil || !created || conv.Status != "pending" {
		t.Fatalf("create pending conv: conv=%+v created=%v err=%v", conv, created, err)
	}

	// 1. Send first permitted message in pending conversation.
	clientMsg1 := messaging.NewUUID()
	msg1, err := svc.SendMessage(ctx, alice, conv.ID, clientMsg1, "First pending message")
	if err != nil {
		t.Fatalf("send 1st pending msg: %v", err)
	}
	if msg1.SequenceNum != 1 {
		t.Fatalf("expected sequence 1, got %d", msg1.SequenceNum)
	}

	// 2. Simulate lost response and retry with the same client_message_id.
	retry, err := svc.SendMessage(ctx, alice, conv.ID, clientMsg1, "First pending message")
	if err != nil {
		t.Fatalf("retry 1st pending msg: %v", err)
	}
	if retry.ID != msg1.ID || retry.SequenceNum != 1 || !retry.CreatedAt.Equal(msg1.CreatedAt) {
		t.Fatalf("retry returned different message: got %+v, want %+v", retry, msg1)
	}

	// Confirm no additional sequence number or outbox event was allocated.
	var lastSeq int64
	var msgCount, outboxCount int
	if err := pool.QueryRow(ctx, "SELECT last_message_sequence FROM conversations WHERE id = $1", conv.ID).Scan(&lastSeq); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM messages WHERE conversation_id = $1", conv.ID).Scan(&msgCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND event_type = 'message.created'", conv.ID).Scan(&outboxCount); err != nil {
		t.Fatal(err)
	}
	if lastSeq != 1 || msgCount != 1 || outboxCount != 1 {
		t.Fatalf("idempotency leaked allocations: lastSeq=%d msgCount=%d outboxCount=%d", lastSeq, msgCount, outboxCount)
	}

	// 3. Confirm a different second message is rejected.
	if _, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Second distinct message"); !errors.Is(err, messaging.ErrPendingLimit) {
		t.Fatalf("expected ErrPendingLimit for second pending message, got %v", err)
	}
}

func TestAuditDeclinedConversationPolicy(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_dec_pol")
	bob := createTestUser(t, pool, "bob_dec_pol")

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_dec_pol")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.DeclineConversation(ctx, bob, conv.ID); err != nil {
		t.Fatal(err)
	}

	// Even if Alice and Bob later mutually follow each other, declined state must NEVER become accepted or pending,
	// and POST /v1/conversations/direct (GetOrCreateDirectConversation) rejects re-initiation by either participant with ErrDeclined.
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	if _, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_dec_pol"); !errors.Is(err, messaging.ErrDeclined) {
		t.Fatalf("initiator get/create after decline: got %v, want ErrDeclined", err)
	}
	if _, _, err := svc.GetOrCreateDirectConversation(ctx, bob, "alice_dec_pol"); !errors.Is(err, messaging.ErrDeclined) {
		t.Fatalf("recipient get/create after decline: got %v, want ErrDeclined", err)
	}

	// GET /v1/conversations and GET /v1/conversations/{id} continue exposing declined status to both participants.
	for _, uid := range []string{alice, bob} {
		list, err := svc.ListConversations(ctx, uid)
		if err != nil {
			t.Fatalf("list conversations for %s: %v", uid, err)
		}
		if len(list) != 1 || list[0].ID != conv.ID || list[0].Status != "declined" {
			t.Fatalf("unexpected list for %s: %+v", uid, list)
		}
		got, err := svc.GetConversation(ctx, uid, conv.ID)
		if err != nil {
			t.Fatalf("get conversation for %s: %v", uid, err)
		}
		if got.Status != "declined" {
			t.Fatalf("expected declined status for %s, got %s", uid, got.Status)
		}
	}

	// Neither accept nor send can bypass declined state.
	if _, err := svc.AcceptConversation(ctx, bob, conv.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("expected ErrForbidden accepting declined conv, got %v", err)
	}
	if _, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "bypass?"); !errors.Is(err, messaging.ErrDeclined) {
		t.Fatalf("expected ErrDeclined sending in declined conv, got %v", err)
	}
}

func TestAuditBlockSendAndCreateConcurrency(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_bs_conc")
	bob := createTestUser(t, pool, "bob_bs_conc")
	carol := createTestUser(t, pool, "carol_bs_conc")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_bs_conc")
	if err != nil {
		t.Fatal(err)
	}

	// Session 1 acquires the pair advisory lock for (alice, bob) inside an explicit PG tx (simulating in-flight BlockUser).
	txBlock, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer txBlock.Rollback(ctx)

	_, err = txBlock.Exec(ctx,
		`SELECT pg_advisory_xact_lock(('x' || substr(md5(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text)), 1, 16))::bit(64)::bigint)`,
		bob, alice,
	)
	if err != nil {
		t.Fatal(err)
	}

	// Session 2 tries SendMessage concurrently; it MUST wait on the pair advisory lock.
	sendDone := make(chan error, 1)
	go func() {
		_, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "race message")
		sendDone <- err
	}()

	select {
	case err := <-sendDone:
		t.Fatalf("SendMessage did not serialize on pair advisory lock; finished early with err=%v", err)
	case <-time.After(120 * time.Millisecond):
		// Expected: blocked waiting for Session 1's pair advisory lock.
	}

	// Session 1 commits the block.
	if _, err := txBlock.Exec(ctx, "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", bob, alice); err != nil {
		t.Fatal(err)
	}
	if err := txBlock.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	// Session 2 now wakes up and MUST observe the committed block and reject the send.
	if err := <-sendDone; !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("concurrent SendMessage after Block commit: got %v, want ErrBlocked", err)
	}

	// Subsequent send after block commits is also rejected.
	if _, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "post-block message"); !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("post-block SendMessage: got %v, want ErrBlocked", err)
	}

	// Verify 0 messages committed in conv.
	var msgCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM messages WHERE conversation_id = $1", conv.ID).Scan(&msgCount); err != nil {
		t.Fatal(err)
	}
	if msgCount != 0 {
		t.Fatalf("expected 0 messages committed after winning block, got %d", msgCount)
	}

	// Now test Conversation Creation vs Block concurrency on (alice, carol) where no conv exists yet.
	txBlock2, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer txBlock2.Rollback(ctx)

	_, err = txBlock2.Exec(ctx,
		`SELECT pg_advisory_xact_lock(('x' || substr(md5(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text)), 1, 16))::bit(64)::bigint)`,
		carol, alice,
	)
	if err != nil {
		t.Fatal(err)
	}

	createDone := make(chan error, 1)
	go func() {
		_, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "carol_bs_conc")
		createDone <- err
	}()

	select {
	case err := <-createDone:
		t.Fatalf("GetOrCreateDirectConversation did not serialize on pair advisory lock; finished early with err=%v", err)
	case <-time.After(120 * time.Millisecond):
	}

	if _, err := txBlock2.Exec(ctx, "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", carol, alice); err != nil {
		t.Fatal(err)
	}
	if err := txBlock2.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	if err := <-createDone; !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("concurrent GetOrCreateDirectConversation after Block commit: got %v, want ErrBlocked", err)
	}

	var convCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM conversations WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)", alice, carol).Scan(&convCount); err != nil {
		t.Fatal(err)
	}
	if convCount != 0 {
		t.Fatalf("expected 0 conversations created after winning block, got %d", convCount)
	}
}

func TestAuditOutboxAtomicityAndIdempotency(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_outbox")
	bob := createTestUser(t, pool, "bob_outbox")

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_outbox")
	if err != nil {
		t.Fatal(err)
	}

	// 1. Fault injection: force outbox_events insert failure to prove message + sequence roll back atomically.
	_, err = pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION fail_outbox_insert() RETURNS trigger AS $$
		BEGIN
			RAISE EXCEPTION 'simulated outbox failure';
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER trg_fail_outbox BEFORE INSERT ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_outbox_insert();
	`)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Should rollback"); err == nil {
		t.Fatalf("expected SendMessage error on outbox trigger failure")
	}

	var msgCount int
	var lastSeq int64
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM messages WHERE conversation_id = $1", conv.ID).Scan(&msgCount)
	_ = pool.QueryRow(ctx, "SELECT last_message_sequence FROM conversations WHERE id = $1", conv.ID).Scan(&lastSeq)
	if msgCount != 0 || lastSeq != 0 {
		t.Fatalf("atomicity violated after outbox failure: msgCount=%d lastSeq=%d", msgCount, lastSeq)
	}

	// Remove fault-injection trigger.
	if _, err := pool.Exec(ctx, "DROP TRIGGER trg_fail_outbox ON outbox_events; DROP FUNCTION fail_outbox_insert();"); err != nil {
		t.Fatal(err)
	}

	// 2. Normal send commits message + 1 outbox event.
	msg1, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Atomic msg 1")
	if err != nil {
		t.Fatal(err)
	}

	// 3. Repeated AcceptConversation emits exactly 1 conversation.updated outbox event.
	if _, err := svc.AcceptConversation(ctx, bob, conv.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AcceptConversation(ctx, bob, conv.ID); err != nil {
		t.Fatal(err)
	}
	var convUpdatedCount int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND event_type = 'conversation.updated'", conv.ID).Scan(&convUpdatedCount)
	if convUpdatedCount != 1 {
		t.Fatalf("expected 1 conversation.updated outbox event across duplicate accepts, got %d", convUpdatedCount)
	}

	// 4. Repeated MarkDelivered and MarkRead emit exactly 1 event each.
	if err := svc.MarkDelivered(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkDelivered(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkRead(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.MarkRead(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}

	var delivCount, readCount int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND event_type = 'message.delivered'", conv.ID).Scan(&delivCount)
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND event_type = 'message.read'", conv.ID).Scan(&readCount)
	if delivCount != 1 || readCount != 1 {
		t.Fatalf("expected 1 delivered and 1 read outbox event, got deliv=%d read=%d", delivCount, readCount)
	}
}

func TestAuditAuthorizationBoundaries(t *testing.T) {
	pool := testdb.Pool(t)
	svc := messaging.NewService(pool)
	ctx := context.Background()

	alice := createTestUser(t, pool, "alice_authz")
	bob := createTestUser(t, pool, "bob_authz")
	eve := createTestUser(t, pool, "eve_authz")
	followUser(t, pool, alice, bob)
	followUser(t, pool, bob, alice)

	conv, _, err := svc.GetOrCreateDirectConversation(ctx, alice, "bob_authz")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Secret chat")
	if err != nil {
		t.Fatal(err)
	}

	// 1. Non-member (Eve) cannot read messages, inspect conversation, send, accept/decline, advance watermarks, or acknowledge delivery.
	if _, err := svc.GetConversation(ctx, eve, conv.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve GetConversation: got %v, want ErrForbidden", err)
	}
	if _, err := svc.ListMessages(ctx, eve, conv.ID, "", "", 10); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve ListMessages: got %v, want ErrForbidden", err)
	}
	if _, err := svc.SendMessage(ctx, eve, conv.ID, messaging.NewUUID(), "Inject"); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve SendMessage: got %v, want ErrForbidden", err)
	}
	// Non-member MarkRead must fail with ErrForbidden whether messageID exists in conv or not (no existence oracle).
	if err := svc.MarkRead(ctx, eve, conv.ID, msg.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve MarkRead existing msgID: got %v, want ErrForbidden", err)
	}
	if err := svc.MarkRead(ctx, eve, conv.ID, messaging.NewUUID()); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve MarkRead random msgID: got %v, want ErrForbidden", err)
	}
	if err := svc.MarkDelivered(ctx, eve, conv.ID, msg.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve MarkDelivered: got %v, want ErrForbidden", err)
	}
	if _, err := svc.AcceptConversation(ctx, eve, conv.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve AcceptConversation: got %v, want ErrForbidden", err)
	}
	if _, err := svc.DeclineConversation(ctx, eve, conv.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("eve DeclineConversation: got %v, want ErrForbidden", err)
	}

	// 2. Sender (Alice) cannot acknowledge her own message as delivered.
	if err := svc.MarkDelivered(ctx, alice, conv.ID, msg.ID); !errors.Is(err, messaging.ErrForbidden) {
		t.Fatalf("alice MarkDelivered own msg: got %v, want ErrForbidden", err)
	}

	// 3. Blocked user cannot bypass blocking using existing conversation ID.
	if err := svc.BlockUser(ctx, alice, "bob_authz"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SendMessage(ctx, bob, conv.ID, messaging.NewUUID(), "Blocked send"); !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("bob SendMessage while blocked by alice: got %v, want ErrBlocked", err)
	}
	if _, err := svc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Blocker send"); !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("alice SendMessage while blocking bob: got %v, want ErrBlocked", err)
	}
}
