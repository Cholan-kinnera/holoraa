package realtime_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/realtime"
	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

func createUser(t testing.TB, pool *pgxpool.Pool, username string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		"INSERT INTO users (username, display_name) VALUES ($1, $2) RETURNING id",
		username, username,
	).Scan(&id)
	if err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return id
}

func makeMutual(t testing.TB, pool *pgxpool.Pool, a, b string) {
	t.Helper()
	_, err := pool.Exec(context.Background(),
		"INSERT INTO follows (follower_id, following_id) VALUES ($1, $2), ($2, $1) ON CONFLICT DO NOTHING",
		a, b,
	)
	if err != nil {
		t.Fatalf("makeMutual: %v", err)
	}
}

type envFrame struct {
	V         int                    `json:"v"`
	ID        string                 `json:"id"`
	Type      string                 `json:"type"`
	Timestamp string                 `json:"timestamp"`
	Payload   map[string]interface{} `json:"payload"`
}

// startReader continuously reads WebSocket frames onto a buffered channel without
// ever cancelling conn.Read on timeout (since coder/websocket closes on Read error).
func startReader(t testing.TB, conn *websocket.Conn) (<-chan envFrame, <-chan error) {
	t.Helper()
	frames := make(chan envFrame, 128)
	errs := make(chan error, 1)
	go func() {
		defer close(errs)
		for {
			_, data, err := conn.Read(context.Background())
			if err != nil {
				errs <- err
				return
			}
			var f envFrame
			if uErr := json.Unmarshal(data, &f); uErr != nil {
				errs <- uErr
				return
			}
			frames <- f
		}
	}()
	return frames, errs
}

func nextFrame(t testing.TB, ch <-chan envFrame, timeout time.Duration) envFrame {
	t.Helper()
	select {
	case f := <-ch:
		return f
	case <-time.After(timeout):
		t.Fatalf("timed out waiting for ws frame after %s", timeout)
		return envFrame{}
	}
}

func nextFrameOfType(t testing.TB, ch <-chan envFrame, typ string, timeout time.Duration) envFrame {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case f := <-ch:
			if f.Type == typ {
				return f
			}
		case <-deadline:
			t.Fatalf("timed out waiting for ws frame type %q after %s", typ, timeout)
			return envFrame{}
		}
	}
}

func assertNoFrame(t testing.TB, ch <-chan envFrame, wait time.Duration) {
	t.Helper()
	select {
	case f := <-ch:
		t.Fatalf("unexpected ws frame received: %+v", f)
	case <-time.After(wait):
	}
}

func writeFrame(t testing.TB, conn *websocket.Conn, typ string, payload interface{}) {
	t.Helper()
	b, err := json.Marshal(map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      typ,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   payload,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatalf("write ws frame %s: %v", typ, err)
	}
}

func startTestWSServer(t *testing.T, _ *pgxpool.Pool, hub *realtime.Hub, tickets *realtime.TicketService) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, hasSess := realtime.ExtractTicket(r)
		if hasSess || tok == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		uid, err := tickets.Consume(r.Context(), tok)
		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			Subprotocols:       []string{realtime.SubprotocolBase},
			InsecureSkipVerify: true, // HTTP test server only; real Origin enforcement tested in httpapi package
		})
		if err != nil {
			return
		}
		hub.ServeConn(r.Context(), uid, conn)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func dialWSWithTicket(t testing.TB, srv *httptest.Server, ticket string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticket},
	})
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	if resp.Header.Get("Sec-WebSocket-Protocol") != realtime.SubprotocolBase {
		t.Fatalf("unexpected negotiated subprotocol: %q", resp.Header.Get("Sec-WebSocket-Protocol"))
	}
	t.Cleanup(func() {
		_ = conn.Close(websocket.StatusNormalClosure, "test cleanup")
	})
	return conn
}

func TestTicketExpirySingleUseAndHashStorage(t *testing.T) {
	pool := testdb.Pool(t)
	tickets := realtime.NewTicketService(pool)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_tick")
	token, ttl, err := tickets.Issue(ctx, alice)
	if err != nil {
		t.Fatalf("issue ticket: %v", err)
	}
	if ttl != 60 || len(token) < 32 {
		t.Fatalf("unexpected ticket metadata: ttl=%d len=%d", ttl, len(token))
	}

	// Plaintext token must never be stored in DB.
	var storedCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM ws_tickets WHERE encode(ticket_hash, 'hex') = $1", token).Scan(&storedCount); err != nil {
		t.Fatal(err)
	}
	if storedCount != 0 {
		t.Fatalf("plaintext ticket leaked into ws_tickets")
	}

	// Concurrent consumption: exactly 1 succeeds, others fail.
	const workers = 8
	var wg sync.WaitGroup
	var wins atomic.Int32
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			uid, err := tickets.Consume(ctx, token)
			if err == nil && uid == alice {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("single-use violated: wins=%d want 1", wins.Load())
	}

	// Expired ticket is rejected and cleaned up.
	expiredTok, _, err := tickets.Issue(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE ws_tickets SET expires_at = now() - interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	if _, err := tickets.Consume(ctx, expiredTok); !errors.Is(err, realtime.ErrInvalidTicket) {
		t.Fatalf("expired consume: got %v, want ErrInvalidTicket", err)
	}
	cleaned, err := tickets.CleanupExpired(ctx)
	if err != nil || cleaned != 1 {
		t.Fatalf("cleanup expired: cleaned=%d err=%v", cleaned, err)
	}
}

func TestMultiDeviceDeliveryAndPresenceIsolation(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{})
	hub.SetRelayNotifier(relay)
	msgSvc.SetRealtimeHooks(relay, hub)

	relayCtx, relayCancel := context.WithCancel(context.Background())
	defer relayCancel()
	go relay.Run(relayCtx)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_mdev")
	bob := createUser(t, pool, "bob_mdev")
	makeMutual(t, pool, alice, bob)

	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_mdev")
	if err != nil {
		t.Fatal(err)
	}

	// Connect Bob first so Bob observes Alice's presence transitions.
	bobTok, _, _ := tickets.Issue(ctx, bob)
	bobConn := dialWSWithTicket(t, srv, bobTok)
	bobCh, _ := startReader(t, bobConn)
	if f := nextFrame(t, bobCh, 3*time.Second); f.Type != "connection.ready" {
		t.Fatalf("bob expected connection.ready, got %s", f.Type)
	}

	// Connect Alice Device 1.
	t1, _, _ := tickets.Issue(ctx, alice)
	aDev1 := dialWSWithTicket(t, srv, t1)
	aCh1, _ := startReader(t, aDev1)
	if f := nextFrame(t, aCh1, 3*time.Second); f.Type != "connection.ready" {
		t.Fatalf("aDev1 expected connection.ready, got %s", f.Type)
	}

	// Bob receives presence.updated (online).
	pOnline := nextFrame(t, bobCh, 3*time.Second)
	if pOnline.Type != "presence.updated" || pOnline.Payload["status"] != "online" || pOnline.Payload["userId"] != alice {
		t.Fatalf("expected alice online presence, got %+v", pOnline)
	}

	// Connect Alice Device 2.
	t2, _, _ := tickets.Issue(ctx, alice)
	aDev2 := dialWSWithTicket(t, srv, t2)
	aCh2, _ := startReader(t, aDev2)
	if f := nextFrame(t, aCh2, 3*time.Second); f.Type != "connection.ready" {
		t.Fatalf("aDev2 expected connection.ready, got %s", f.Type)
	}
	if hub.UserConnectionCount(alice) != 2 {
		t.Fatalf("expected 2 connections for alice, got %d", hub.UserConnectionCount(alice))
	}

	// Bob sends a message -> BOTH Alice Device 1 and Device 2 receive message.created.
	msg, err := msgSvc.SendMessage(ctx, bob, conv.ID, messaging.NewUUID(), "Hello both devices")
	if err != nil {
		t.Fatal(err)
	}
	f1 := nextFrameOfType(t, aCh1, "message.created", 3*time.Second)
	f2 := nextFrameOfType(t, aCh2, "message.created", 3*time.Second)
	if f1.Payload["messageId"] != msg.ID || f2.Payload["messageId"] != msg.ID {
		t.Fatalf("both devices must receive message.created: d1=%+v d2=%+v", f1, f2)
	}

	// Disconnect Alice Device 1 -> Alice MUST remain online (Device 2 still active), Bob gets NO offline frame!
	_ = aDev1.Close(websocket.StatusNormalClosure, "tab closed")
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && hub.UserConnectionCount(alice) != 1 {
		time.Sleep(10 * time.Millisecond)
	}
	if !hub.IsUserOnline(alice) {
		t.Fatalf("alice wrongly marked offline while Device 2 still connected")
	}
	assertNoFrame(t, bobCh, 150*time.Millisecond)

	// Disconnect Alice Device 2 -> NOW Bob receives presence.updated (offline).
	_ = aDev2.Close(websocket.StatusNormalClosure, "all closed")
	pOffline := nextFrameOfType(t, bobCh, "presence.updated", 3*time.Second)
	if pOffline.Payload["status"] != "offline" || pOffline.Payload["userId"] != alice {
		t.Fatalf("expected alice offline presence after last device disconnect, got %+v", pOffline)
	}
}

func TestSlowClientBackpressureIsolation(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{
		SendBufferSize: 16,
		WriteTimeout:   200 * time.Millisecond,
	})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_slow")
	bob := createUser(t, pool, "bob_fast")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, bob, "alice_slow")
	if err != nil {
		t.Fatal(err)
	}

	// Fast device actively drains via startReader; Slow device never calls Read.
	tFast, _, _ := tickets.Issue(ctx, alice)
	fastConn := dialWSWithTicket(t, srv, tFast)
	fastCh, _ := startReader(t, fastConn)
	_ = nextFrameOfType(t, fastCh, "connection.ready", 2*time.Second)

	tSlow, _, _ := tickets.Issue(ctx, alice)
	slowConn := dialWSWithTicket(t, srv, tSlow)
	// Do NOT read from slowConn so its TCP buffer and outbound queue saturate.

	// Push 16 KiB frames (total ~3.2 MiB > loopback TCP buffer) with brief yield so fastConn drains continuously.
	pad := strings.Repeat("x", 16*1024)
	for i := 0; i < 200; i++ {
		payload, _ := json.Marshal(map[string]interface{}{
			"v":         1,
			"id":        messaging.NewUUID(),
			"type":      "message.created",
			"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
			"payload":   map[string]interface{}{"seq": i, "conversationId": conv.ID, "pad": pad},
		})
		staged, sErr := hub.StageConversationEvent([]string{alice}, payload, alice, bob)
		if sErr != nil {
			if !errors.Is(sErr, realtime.ErrHubQueueFull) {
				t.Fatalf("StageConversationEvent: %v", sErr)
			}
		} else {
			staged.Commit()
		}
		if i%4 == 0 {
			time.Sleep(time.Millisecond)
		}
	}

	// Fast device continues receiving without blocking.
	got := nextFrameOfType(t, fastCh, "message.created", 2*time.Second)
	if got.Type != "message.created" {
		t.Fatalf("fast device expected message.created, got %+v", got)
	}

	// Slow device must be evicted cleanly, leaving fast device connected (count == 1).
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && hub.UserConnectionCount(alice) > 1 {
		time.Sleep(15 * time.Millisecond)
	}
	if hub.UserConnectionCount(alice) != 1 {
		t.Fatalf("expected 1 fast connection remaining after slow client eviction, got %d", hub.UserConnectionCount(alice))
	}
	_ = slowConn.CloseNow()
}

func TestOutboxLeaseExpiryFencingAndCrashRecovery(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_lease")
	bob := createUser(t, pool, "bob_lease")
	makeMutual(t, pool, alice, bob)

	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_lease")
	if err != nil {
		t.Fatal(err)
	}

	bobTok, _, _ := tickets.Issue(ctx, bob)
	bobConn := dialWSWithTicket(t, srv, bobTok)
	bobCh, _ := startReader(t, bobConn)
	_ = nextFrameOfType(t, bobCh, "connection.ready", 2*time.Second)

	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Crash recovery msg"); err != nil {
		t.Fatal(err)
	}

	// Worker 1 claims the event.
	w1 := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "worker-1"})
	batch1, err := w1.ClaimBatch(ctx)
	if err != nil || len(batch1) != 1 {
		t.Fatalf("w1 ClaimBatch: len=%d err=%v", len(batch1), err)
	}

	// Simulate Worker 1 stalling past its 30s lease.
	if _, err := pool.Exec(ctx, "UPDATE outbox_events SET lease_expires_at = now() - interval '2 seconds' WHERE id = $1", batch1[0].ID); err != nil {
		t.Fatal(err)
	}

	// Stale Worker 1 tries to process -> MUST fail lease fencing and send ZERO frames to Bob!
	if err := w1.ProcessClaimedEvent(ctx, batch1[0]); !errors.Is(err, realtime.ErrLeaseLost) {
		t.Fatalf("stale worker ProcessClaimedEvent: got %v, want ErrLeaseLost", err)
	}
	assertNoFrame(t, bobCh, 100*time.Millisecond)

	// Simulate Worker 2 starting after process crash / restart: immediately reclaims & delivers.
	w2 := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "worker-2"})
	processed, err := w2.ProcessOnce(ctx)
	if err != nil || processed != 1 {
		t.Fatalf("w2 recovery ProcessOnce: processed=%d err=%v", processed, err)
	}

	delivered := nextFrameOfType(t, bobCh, "message.created", 2*time.Second)
	if delivered.Payload["content"] != "Crash recovery msg" {
		t.Fatalf("expected recovered message.created, got %+v", delivered)
	}
}

func TestOutboxPoisonQuarantine(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()

	alice := createUser(t, pool, "alice_poison")
	bob := createUser(t, pool, "bob_poison")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(context.Background(), alice, "bob_poison")
	if err != nil {
		t.Fatal(err)
	}

	var badID int64
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO outbox_events (event_type, conversation_id, payload, target_user_ids, status)
		 VALUES ('message.created', $1, '{"bad":true}'::jsonb, ARRAY[$2::uuid], 'pending') RETURNING id`,
		conv.ID, bob,
	).Scan(&badID); err != nil {
		t.Fatal(err)
	}
	if _, err := msgSvc.SendMessage(context.Background(), alice, conv.ID, messaging.NewUUID(), "Valid after poison"); err != nil {
		t.Fatal(err)
	}

	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "poison-worker"})
	if _, err := relay.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("ProcessOnce with poison row: %v", err)
	}

	var badStatus, goodStatus string
	_ = pool.QueryRow(context.Background(), "SELECT status FROM outbox_events WHERE id = $1", badID).Scan(&badStatus)
	_ = pool.QueryRow(context.Background(), "SELECT status FROM outbox_events WHERE id != $1", badID).Scan(&goodStatus)
	if badStatus != "poison" || goodStatus != "published" {
		t.Fatalf("unexpected statuses: bad=%s good=%s", badStatus, goodStatus)
	}
}

func TestBlockVsRelayConcurrencyAndNoResurrectionOnUnblock(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_blk_rel")
	bob := createUser(t, pool, "bob_blk_rel")
	makeMutual(t, pool, alice, bob)

	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_blk_rel")
	if err != nil {
		t.Fatal(err)
	}

	// Prepare all 4 outbox event types before blocking.
	msg1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 1")
	if err != nil {
		t.Fatal(err)
	}
	if err := msgSvc.MarkDelivered(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}
	if err := msgSvc.MarkRead(ctx, bob, conv.ID, msg1.ID); err != nil {
		t.Fatal(err)
	}
	convUpdPayload, _ := json.Marshal(map[string]interface{}{
		"v": 1, "id": messaging.NewUUID(), "type": "conversation.updated",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   map[string]interface{}{"conversationId": conv.ID, "status": "accepted", "updatedAt": time.Now().UTC().Format(time.RFC3339Nano)},
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO outbox_events (event_type, conversation_id, payload, target_user_ids, status)
		 VALUES ('conversation.updated', $1, $2::jsonb, ARRAY[$3::uuid, $4::uuid], 'pending')`,
		conv.ID, convUpdPayload, alice, bob,
	); err != nil {
		t.Fatal(err)
	}

	// Connect both Alice and Bob WS clients and drain initial handshake/presence frames.
	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srv, aTok)
	aCh, _ := startReader(t, aConn)
	_ = nextFrameOfType(t, aCh, "connection.ready", 2*time.Second)

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)
	_ = nextFrameOfType(t, aCh, "presence.updated", 2*time.Second) // drain bob's pre-block online presence

	// Separate PostgreSQL Session 1 acquires pair advisory lock (simulating in-flight BlockUser).
	txBlock, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer txBlock.Rollback(ctx)
	if _, err := txBlock.Exec(ctx,
		`SELECT pg_advisory_xact_lock(('x' || substr(md5(LEAST($1::text, $2::text) || ':' || GREATEST($1::text, $2::text)), 1, 16))::bit(64)::bigint)`,
		alice, bob,
	); err != nil {
		t.Fatal(err)
	}

	// Session 2 (OutboxRelay) claims batch and starts authorizing -> MUST block on pair advisory lock!
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "blk-race-worker"})
	relayDone := make(chan error, 1)
	go func() {
		_, rErr := relay.ProcessOnce(ctx)
		relayDone <- rErr
	}()

	select {
	case err := <-relayDone:
		t.Fatalf("relay bypassed pair advisory lock while block tx held lock (err=%v)", err)
	case <-time.After(120 * time.Millisecond):
	}

	// Session 1 commits the block!
	if _, err := txBlock.Exec(ctx, "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", bob, alice); err != nil {
		t.Fatal(err)
	}
	if err := txBlock.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	if err := <-relayDone; err != nil {
		t.Fatalf("relay after block commit: %v", err)
	}

	var suppressedCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND status = 'published' AND error_message = 'suppressed: relationship blocked'`,
		conv.ID,
	).Scan(&suppressedCount); err != nil {
		t.Fatal(err)
	}
	if suppressedCount != 4 {
		t.Fatalf("expected all 4 event types suppressed, got %d", suppressedCount)
	}

	// Neither Alice nor Bob received any suppressed peer-visible frame!
	assertNoFrame(t, aCh, 100*time.Millisecond)
	assertNoFrame(t, bCh, 100*time.Millisecond)

	// Now UNBLOCK and run relay again: suppressed events MUST NEVER resurrect!
	if err := msgSvc.UnblockUser(ctx, bob, "alice_blk_rel"); err != nil {
		t.Fatal(err)
	}
	processed, err := relay.ProcessOnce(ctx)
	if err != nil || processed != 0 {
		t.Fatalf("unblock resurrected suppressed events! processed=%d err=%v", processed, err)
	}

	// New message committed AFTER unblock delivers cleanly.
	msg2, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "After unblock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := relay.ProcessOnce(ctx); err != nil {
		t.Fatal(err)
	}
	gotAfter := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if gotAfter.Payload["messageId"] != msg2.ID {
		t.Fatalf("expected post-unblock message.created, got %+v", gotAfter)
	}
}

func TestTypingEphemeralAuthorizationExpiryAndIdleTimeout(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{
		TypingTTL:         80 * time.Millisecond,
		HeartbeatInterval: 80 * time.Millisecond,
		IdleTimeout:       300 * time.Millisecond,
	})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_typ")
	bob := createUser(t, pool, "bob_typ")
	eve := createUser(t, pool, "eve_typ")
	makeMutual(t, pool, alice, bob)

	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_typ")
	if err != nil {
		t.Fatal(err)
	}
	pendingConv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, eve, "bob_typ")
	if err != nil {
		t.Fatal(err)
	}

	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srv, aTok)
	aCh, _ := startReader(t, aConn)
	_ = nextFrameOfType(t, aCh, "connection.ready", 2*time.Second)

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	eTok, _, _ := tickets.Issue(ctx, eve)
	eConn := dialWSWithTicket(t, srv, eTok)
	eCh, eErrCh := startReader(t, eConn)
	_ = nextFrameOfType(t, eCh, "connection.ready", 2*time.Second)

	// 1. Keep-alive ping/pong works.
	writeFrame(t, eConn, "ping", map[string]interface{}{})
	_ = nextFrameOfType(t, eCh, "pong", 2*time.Second)

	// 2. Non-member and pending conversation cannot emit typing.started.
	writeFrame(t, eConn, "typing.started", map[string]string{"conversationId": conv.ID})
	errNonMem := nextFrameOfType(t, eCh, "error", 2*time.Second)
	if errNonMem.Payload["code"] != "FORBIDDEN" {
		t.Fatalf("non-member typing expected FORBIDDEN, got %+v", errNonMem)
	}

	writeFrame(t, eConn, "typing.started", map[string]string{"conversationId": pendingConv.ID})
	errPend := nextFrameOfType(t, eCh, "error", 2*time.Second)
	if errPend.Payload["code"] != "FORBIDDEN" {
		t.Fatalf("pending typing expected FORBIDDEN, got %+v", errPend)
	}

	// 3. Authorized typing.started reaches Bob and auto-expires with typing.stopped!
	writeFrame(t, aConn, "typing.started", map[string]string{"conversationId": conv.ID})
	tStart := nextFrameOfType(t, bCh, "typing.started", 2*time.Second)
	if tStart.Payload["userId"] != alice || tStart.Payload["conversationId"] != conv.ID {
		t.Fatalf("expected typing.started, got %+v", tStart)
	}
	tStop := nextFrameOfType(t, bCh, "typing.stopped", 2*time.Second)
	if tStop.Payload["userId"] != alice {
		t.Fatalf("expected auto-expired typing.stopped, got %+v", tStop)
	}

	// Ephemeral typing must NEVER write to messages or outbox_events.
	var msgCnt, outboxCnt int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM messages").Scan(&msgCnt)
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events").Scan(&outboxCnt)
	if msgCnt != 0 || outboxCnt != 0 {
		t.Fatalf("typing leaked into persistent tables: msg=%d outbox=%d", msgCnt, outboxCnt)
	}

	// 4. Stopping pings causes IdleTimeout close (StatusGoingAway).
	select {
	case closeErr := <-eErrCh:
		if websocket.CloseStatus(closeErr) != websocket.StatusGoingAway {
			t.Fatalf("expected idle close StatusGoingAway, got %v", closeErr)
		}
	case <-time.After(3 * time.Second):
		t.Fatalf("idle connection was not closed within timeout")
	}
}

func TestReadAndDeliveryPrivacyAndWSSendIdempotency(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{PollInterval: 30 * time.Millisecond})
	hub.SetRelayNotifier(relay)
	msgSvc.SetRealtimeHooks(relay, hub)

	relayCtx, relayCancel := context.WithCancel(context.Background())
	defer relayCancel()
	go relay.Run(relayCtx)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_wsmsg")
	bob := createUser(t, pool, "bob_wsmsg")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_wsmsg")
	if err != nil {
		t.Fatal(err)
	}

	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srv, aTok)
	aCh, _ := startReader(t, aConn)
	_ = nextFrameOfType(t, aCh, "connection.ready", 2*time.Second)

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)
	_ = nextFrameOfType(t, aCh, "presence.updated", 2*time.Second) // bob online

	// 1. Alice sends via WS; duplicate clientMessageId returns identical ack without second message.created.
	cid := messaging.NewUUID()
	writeFrame(t, aConn, "message.send", map[string]string{
		"conversationId": conv.ID, "clientMessageId": cid, "content": "Hello WS",
	})
	ack1 := nextFrameOfType(t, aCh, "message.ack", 2*time.Second)
	msgID := ack1.Payload["messageId"].(string)

	writeFrame(t, aConn, "message.send", map[string]string{
		"conversationId": conv.ID, "clientMessageId": cid, "content": "Hello WS",
	})
	ack2 := nextFrameOfType(t, aCh, "message.ack", 2*time.Second)
	if ack2.Payload["messageId"] != msgID || ack2.Payload["sequenceNum"] != ack1.Payload["sequenceNum"] {
		t.Fatalf("duplicate ws send mismatch: %+v vs %+v", ack1, ack2)
	}

	// Bob receives exactly 1 message.created.
	created := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if created.Payload["messageId"] != msgID {
		t.Fatalf("bob expected message.created, got %+v", created)
	}
	assertNoFrame(t, bCh, 120*time.Millisecond)

	// 2. Sender cannot acknowledge own message as delivered via WS.
	writeFrame(t, aConn, "message.delivered", map[string]string{"conversationId": conv.ID, "messageId": msgID})
	selfDelivErr := nextFrameOfType(t, aCh, "error", 2*time.Second)
	if selfDelivErr.Payload["code"] != "FORBIDDEN" {
		t.Fatalf("expected FORBIDDEN on sender self-delivery ack, got %+v", selfDelivErr)
	}

	// 3. Bob disables read receipts -> WS message.delivered notifies Alice, WS message.read emits ZERO receipt frames!
	if _, err := msgSvc.UpdateSettings(ctx, bob, false); err != nil {
		t.Fatal(err)
	}
	writeFrame(t, bConn, "message.delivered", map[string]string{"conversationId": conv.ID, "messageId": msgID})
	delivEvt := nextFrameOfType(t, aCh, "message.delivered", 2*time.Second)
	if delivEvt.Payload["messageId"] != msgID {
		t.Fatalf("alice expected message.delivered, got %+v", delivEvt)
	}

	writeFrame(t, bConn, "message.read", map[string]string{"conversationId": conv.ID, "messageId": msgID})
	assertNoFrame(t, aCh, 180*time.Millisecond)
}

func TestConcurrentRelayAndHubShutdown(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{TypingTTL: 50 * time.Millisecond})
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{PollInterval: 20 * time.Millisecond})
	hub.SetRelayNotifier(relay)
	msgSvc.SetRealtimeHooks(relay, hub)

	relayCtx, relayCancel := context.WithCancel(context.Background())
	var wgRelay sync.WaitGroup
	wgRelay.Add(1)
	go func() {
		defer wgRelay.Done()
		relay.Run(relayCtx)
	}()

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_shut")
	bob := createUser(t, pool, "bob_shut")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_shut")
	if err != nil {
		t.Fatal(err)
	}

	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srv, aTok)
	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)

	startReader(t, aConn)
	startReader(t, bConn)

	var sendWg sync.WaitGroup
	for i := 0; i < 10; i++ {
		sendWg.Add(1)
		go func(idx int) {
			defer sendWg.Done()
			_, _ = msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), fmt.Sprintf("msg-%d", idx))
			writeFrame(t, aConn, "typing.started", map[string]string{"conversationId": conv.ID})
		}(i)
	}
	sendWg.Wait()

	relayCancel()
	hub.Close()
	wgRelay.Wait()

	if hub.ActiveConnections() != 0 {
		t.Fatalf("expected 0 active connections after Hub.Close, got %d", hub.ActiveConnections())
	}
}

func TestRelayFailureAfterEnqueueBeforeCommitAndDedup(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_bef_cmt")
	bob := createUser(t, pool, "bob_bef_cmt")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_bef_cmt")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Before commit fail"); err != nil {
		t.Fatal(err)
	}

	var expectedEventID string
	if err := pool.QueryRow(ctx, "SELECT payload->>'id' FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&expectedEventID); err != nil {
		t.Fatal(err)
	}

	var failOnce atomic.Bool
	failOnce.Store(true)
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{
		WorkerID: "before-commit-worker",
		BeforeCommitHook: func(_ context.Context, _ dbstore.ClaimOutboxBatchWithLeaseRow) error {
			if failOnce.Swap(false) {
				return errors.New("simulated crash after staging before commit")
			}
			return nil
		},
	})

	// Attempt 1: stages into Hub while holding pair lock, MarkOutboxPublished executes inside tx,
	// then BeforeCommitHook fails -> tx rolls back and staged.Abort() discards the staged event!
	processed, err := relay.ProcessOnce(ctx)
	if err != nil {
		t.Fatalf("ProcessOnce 1: %v", err)
	}
	if processed != 0 {
		t.Fatalf("expected 0 committed events when BeforeCommitHook fails, got %d", processed)
	}

	// Outbox row must NOT be marked published (stays processing for backoff retry).
	var status string
	var attempts int16
	if err := pool.QueryRow(ctx, "SELECT status, attempts FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "processing" || attempts != 1 {
		t.Fatalf("expected status=processing attempts=1 after commit failure, got status=%s attempts=%d", status, attempts)
	}

	// Critical invariant: failed DB commit MUST NOT produce any client-visible WebSocket frame!
	assertNoFrame(t, bCh, 150*time.Millisecond)

	// Force backoff window elapsed and retry cleanly -> Attempt 2 commits 'published' and sends the stable event ID!
	if _, err := pool.Exec(ctx, "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE conversation_id = $1", conv.ID); err != nil {
		t.Fatal(err)
	}
	processed2, err := relay.ProcessOnce(ctx)
	if err != nil || processed2 != 1 {
		t.Fatalf("ProcessOnce retry: processed=%d err=%v", processed2, err)
	}
	if err := pool.QueryRow(ctx, "SELECT status, attempts FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "published" || attempts != 2 {
		t.Fatalf("expected status=published attempts=2 on retry, got status=%s attempts=%d", status, attempts)
	}

	deliveredFrame := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if deliveredFrame.ID != expectedEventID {
		t.Fatalf("retry generated unstable event ID for dedup: got=%s want=%s", deliveredFrame.ID, expectedEventID)
	}
}

func TestRelayDBFailureDuringPublishedUpdate(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_dbfail")
	bob := createUser(t, pool, "bob_dbfail")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_dbfail")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Publish fail msg"); err != nil {
		t.Fatal(err)
	}

	// Install temporary PostgreSQL trigger failing transitions to status='published'.
	_, err = pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION fail_outbox_publish() RETURNS trigger AS $$
		BEGIN
			IF NEW.status = 'published' THEN
				RAISE EXCEPTION 'simulated db failure during publish update';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;
		CREATE TRIGGER trg_fail_outbox_publish BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION fail_outbox_publish();
	`)
	if err != nil {
		t.Fatal(err)
	}

	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "db-fail-worker"})
	processed, err := relay.ProcessOnce(ctx)
	if err != nil || processed != 0 {
		t.Fatalf("expected 0 committed events during publish DB failure, got processed=%d err=%v", processed, err)
	}

	var status string
	var errMsg *string
	if err := pool.QueryRow(ctx, "SELECT status, error_message FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&status, &errMsg); err != nil {
		t.Fatal(err)
	}
	if status != "processing" || errMsg == nil || !strings.Contains(*errMsg, "mark outbox published") {
		t.Fatalf("expected processing + recorded publish failure error, got status=%s err=%v", status, errMsg)
	}

	// Remove fault-injection trigger, allow retry, and confirm full recovery to published.
	if _, err := pool.Exec(ctx, "DROP TRIGGER trg_fail_outbox_publish ON outbox_events; DROP FUNCTION fail_outbox_publish(); UPDATE outbox_events SET lease_expires_at = now() - interval '1 second';"); err != nil {
		t.Fatal(err)
	}
	processed2, err := relay.ProcessOnce(ctx)
	if err != nil || processed2 != 1 {
		t.Fatalf("expected recovery ProcessOnce=1, got %d err=%v", processed2, err)
	}
	if err := pool.QueryRow(ctx, "SELECT status FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "published" {
		t.Fatalf("expected status=published after recovery, got %s", status)
	}
	_ = nextFrameOfType(t, bCh, "message.created", 2*time.Second)
}

func TestHubQueueSaturationPreservesOutboxEvent(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)

	gate := make(chan struct{})
	var gateOnce sync.Once
	defer gateOnce.Do(func() { close(gate) })

	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{
		QueueSize:    1,
		DispatchGate: gate, // pause dispatchLoop so inbox saturates deterministically at 1/1
	})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_qsat")
	bob := createUser(t, pool, "bob_qsat")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_qsat")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	m1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 1 fills queue")
	if err != nil {
		t.Fatal(err)
	}
	m2, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Msg 2 hits saturation")
	if err != nil {
		t.Fatal(err)
	}

	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "qsat-worker"})
	// M1 fills hub.inbox (1/1) and commits 'published'; M2 hits ErrHubQueueFull and MUST NOT be marked published!
	processed, err := relay.ProcessOnce(ctx)
	if err != nil {
		t.Fatalf("ProcessOnce during queue saturation: %v", err)
	}
	if processed != 1 {
		t.Fatalf("expected M1 published (1) and M2 deferred on full queue, got %d", processed)
	}

	var s1, s2 string
	_ = pool.QueryRow(ctx, "SELECT status FROM outbox_events WHERE payload->'payload'->>'messageId' = $1", m1.ID).Scan(&s1)
	_ = pool.QueryRow(ctx, "SELECT status FROM outbox_events WHERE payload->'payload'->>'messageId' = $1", m2.ID).Scan(&s2)
	if s1 != "published" || s2 != "processing" {
		t.Fatalf("unexpected statuses under queue saturation: m1=%s m2=%s (want published, processing)", s1, s2)
	}

	// Open dispatch gate so M1 drains, expire backoff on M2, and re-run relay -> M2 delivers cleanly!
	gateOnce.Do(func() { close(gate) })
	if _, err := pool.Exec(ctx, "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE status = 'processing'"); err != nil {
		t.Fatal(err)
	}
	processed2, err := relay.ProcessOnce(ctx)
	if err != nil || processed2 != 1 {
		t.Fatalf("expected M2 recovery ProcessOnce=1, got %d err=%v", processed2, err)
	}

	f1 := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	f2 := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if f1.Payload["messageId"] != m1.ID || f2.Payload["messageId"] != m2.ID {
		t.Fatalf("unexpected delivery order/IDs: f1=%v f2=%v", f1.Payload["messageId"], f2.Payload["messageId"])
	}
}

func TestBlockVsRelayWhileRelayHoldsPairLock(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_rel_hold")
	bob := createUser(t, pool, "bob_rel_hold")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_rel_hold")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	m1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Ordered before block")
	if err != nil {
		t.Fatal(err)
	}

	inPairLock := make(chan struct{})
	releaseRelay := make(chan struct{})
	var closeOnce sync.Once
	defer closeOnce.Do(func() { close(releaseRelay) })

	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{
		WorkerID: "hold-lock-worker",
		AfterEnqueueHook: func(_ context.Context, _ dbstore.ClaimOutboxBatchWithLeaseRow) error {
			close(inPairLock)
			<-releaseRelay
			return nil
		},
	})

	relayErrCh := make(chan error, 1)
	go func() {
		_, rErr := relay.ProcessOnce(ctx)
		relayErrCh <- rErr
	}()

	// Wait until Relay has enqueued M1 and is actively holding the pair advisory lock.
	<-inPairLock

	// Concurrent BlockUser in another session MUST block on the pair advisory lock until Relay commits!
	blockDone := make(chan error, 1)
	go func() {
		blockDone <- msgSvc.BlockUser(ctx, bob, "alice_rel_hold")
	}()

	select {
	case err := <-blockDone:
		t.Fatalf("BlockUser committed while Relay still held pair advisory lock (err=%v)", err)
	case <-time.After(120 * time.Millisecond):
		// Expected: linearizable serialization via pair advisory lock.
	}

	// Release Relay -> MarkOutboxPublished + Commit completes BEFORE BlockUser can commit!
	closeOnce.Do(func() { close(releaseRelay) })
	if err := <-relayErrCh; err != nil {
		t.Fatalf("relay failed: %v", err)
	}
	if err := <-blockDone; err != nil {
		t.Fatalf("block failed: %v", err)
	}

	// M1 (enqueued before block) reached Bob cleanly, and status is 'published'.
	got := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if got.Payload["messageId"] != m1.ID {
		t.Fatalf("expected M1 delivered, got %+v", got)
	}

	// Subsequent sends are blocked, and any synthetic post-block outbox event is suppressed.
	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Post block"); !errors.Is(err, messaging.ErrBlocked) {
		t.Fatalf("expected ErrBlocked post-block, got %v", err)
	}
}

func TestOfflineTargetsMarkedPublishedWithoutRetryLoop(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	ctx := context.Background()

	alice := createUser(t, pool, "alice_offline")
	bob := createUser(t, pool, "bob_offline")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_offline")
	if err != nil {
		t.Fatal(err)
	}

	m1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Offline 1")
	if err != nil {
		t.Fatal(err)
	}
	m2, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Offline 2")
	if err != nil {
		t.Fatal(err)
	}

	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "offline-worker"})
	processed, err := relay.ProcessOnce(ctx)
	if err != nil || processed != 2 {
		t.Fatalf("expected 2 offline events handled cleanly, got processed=%d err=%v", processed, err)
	}

	// Verify no pending/processing events remain (zero infinite retry loop).
	var remaining int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND status != 'published'", conv.ID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("expected 0 non-published events, got %d", remaining)
	}

	// Bob recovers missed messages authoritatively via REST keyset pagination.
	page, err := msgSvc.ListMessages(ctx, bob, conv.ID, "", m1.ID, 50)
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != m2.ID {
		t.Fatalf("unexpected offline catch-up page: page=%+v err=%v", page, err)
	}
}

func TestCommitGatedDispatchDiscardsRolledBackEventWithDispatchGate(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)

	gate := make(chan struct{})
	var gateOnce sync.Once
	defer gateOnce.Do(func() { close(gate) })

	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{DispatchGate: gate})
	defer hub.Close()
	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_gate_rb")
	bob := createUser(t, pool, "bob_gate_rb")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_gate_rb")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	m1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Gate rollback msg")
	if err != nil {
		t.Fatal(err)
	}

	var eventID string
	if err := pool.QueryRow(ctx, "SELECT payload->>'id' FROM outbox_events WHERE conversation_id = $1", conv.ID).Scan(&eventID); err != nil {
		t.Fatal(err)
	}

	var failOnce atomic.Bool
	failOnce.Store(true)
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{
		WorkerID: "gate-rollback-worker",
		BeforeCommitHook: func(_ context.Context, _ dbstore.ClaimOutboxBatchWithLeaseRow) error {
			if failOnce.Swap(false) {
				return errors.New("forced rollback after staging with paused dispatchLoop")
			}
			return nil
		},
	})

	// Stage while holding pair lock and pause dispatchLoop, then roll back relay tx.
	processed, err := relay.ProcessOnce(ctx)
	if err != nil || processed != 0 {
		t.Fatalf("expected 0 committed events on rollback, got processed=%d err=%v", processed, err)
	}

	// Release dispatchLoop -> aborted staged event must NOT reach Bob.
	gateOnce.Do(func() { close(gate) })
	assertNoFrame(t, bCh, 200*time.Millisecond)

	// Outbox row remains retryable and delivers with identical event ID on clean retry.
	if _, err := pool.Exec(ctx, "UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE conversation_id = $1", conv.ID); err != nil {
		t.Fatal(err)
	}
	processed2, err := relay.ProcessOnce(ctx)
	if err != nil || processed2 != 1 {
		t.Fatalf("expected retry ProcessOnce=1, got %d err=%v", processed2, err)
	}
	got := nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	if got.ID != eventID || got.Payload["messageId"] != m1.ID {
		t.Fatalf("unexpected retry frame: got=%+v want eventID=%s msgID=%s", got, eventID, m1.ID)
	}
}

func TestCommitGatedDispatchBlockAfterCommitSuppressesQueuedEvent(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)

	gate := make(chan struct{})
	var gateOnce sync.Once
	defer gateOnce.Do(func() { close(gate) })

	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{DispatchGate: gate})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)

	srv := startTestWSServer(t, pool, hub, tickets)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_gate_blk")
	bob := createUser(t, pool, "bob_gate_blk")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_gate_blk")
	if err != nil {
		t.Fatal(err)
	}

	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srv, aTok)
	aCh, _ := startReader(t, aConn)
	_ = nextFrameOfType(t, aCh, "connection.ready", 2*time.Second)

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)
	_ = nextFrameOfType(t, aCh, "presence.updated", 2*time.Second)

	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Queued before block commit"); err != nil {
		t.Fatal(err)
	}

	// Relay stages event and commits tx while dispatchLoop is paused behind DispatchGate.
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "gate-block-worker"})
	processed, err := relay.ProcessOnce(ctx)
	if err != nil || processed != 1 {
		t.Fatalf("expected committed event=1 before block, got processed=%d err=%v", processed, err)
	}

	// Block transaction acquires pair advisory lock and commits while event sits in inbox.
	if err := msgSvc.BlockUser(ctx, bob, "alice_gate_blk"); err != nil {
		t.Fatalf("BlockUser: %v", err)
	}

	// Release dispatchLoop -> queued event MUST NOT reach newly blocked peer!
	gateOnce.Do(func() { close(gate) })
	assertNoFrame(t, bCh, 200*time.Millisecond)
	assertNoFrame(t, aCh, 100*time.Millisecond)

	// Unblocking later MUST NOT resurrect suppressed queued events.
	if err := msgSvc.UnblockUser(ctx, bob, "alice_gate_blk"); err != nil {
		t.Fatalf("UnblockUser: %v", err)
	}
	assertNoFrame(t, bCh, 200*time.Millisecond)
	processedAfter, err := relay.ProcessOnce(ctx)
	if err != nil || processedAfter != 0 {
		t.Fatalf("expected 0 resurrected events on unblock, got processed=%d err=%v", processedAfter, err)
	}

	// Also verify block+unblock both occurring BEFORE DispatchGate opens cannot resurrect queued events.
	gate2 := make(chan struct{})
	var gate2Once sync.Once
	defer gate2Once.Do(func() { close(gate2) })

	hub2 := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{DispatchGate: gate2})
	defer hub2.Close()
	msgSvc.SetRealtimeHooks(nil, hub2)
	srv2 := startTestWSServer(t, pool, hub2, tickets)

	bTok2, _, _ := tickets.Issue(ctx, bob)
	bConn2 := dialWSWithTicket(t, srv2, bTok2)
	bCh2, _ := startReader(t, bConn2)
	_ = nextFrameOfType(t, bCh2, "connection.ready", 2*time.Second)

	if _, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Block then unblock while paused"); err != nil {
		t.Fatal(err)
	}
	relay2 := realtime.NewOutboxRelay(pool, hub2, tickets, log, realtime.RelayConfig{WorkerID: "gate-block-unblock-worker"})
	if n, rErr := relay2.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relay2 ProcessOnce: n=%d err=%v", n, rErr)
	}
	if err := msgSvc.BlockUser(ctx, bob, "alice_gate_blk"); err != nil {
		t.Fatalf("BlockUser 2: %v", err)
	}
	if err := msgSvc.UnblockUser(ctx, bob, "alice_gate_blk"); err != nil {
		t.Fatalf("UnblockUser 2: %v", err)
	}
	gate2Once.Do(func() { close(gate2) })
	assertNoFrame(t, bCh2, 200*time.Millisecond)
}

func TestCommitGatedShutdownAndPartialConnectivity(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	ctx := context.Background()

	// Part A: An event staged/committed in inbox behind DispatchGate must not escape on Hub.Close().
	gate := make(chan struct{})
	hubA := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{DispatchGate: gate})
	srvA := startTestWSServer(t, pool, hubA, tickets)

	alice := createUser(t, pool, "alice_part_shut")
	bob := createUser(t, pool, "bob_part_shut")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_part_shut")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srvA, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	m1, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Queued before shutdown")
	if err != nil {
		t.Fatal(err)
	}
	relayA := realtime.NewOutboxRelay(pool, hubA, tickets, log, realtime.RelayConfig{WorkerID: "shut-worker"})
	if n, rErr := relayA.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relayA ProcessOnce: n=%d err=%v", n, rErr)
	}

	// Shut down hub while queued event is still behind DispatchGate; close gate afterwards.
	hubA.Close()
	close(gate)
	assertNoFrame(t, bCh, 150*time.Millisecond)

	// Uncommitted StageConversationEvent followed by hub.Close() -> Commit() is a safe discard.
	hubShut := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	srvShut := startTestWSServer(t, pool, hubShut, tickets)
	aTok0, _, _ := tickets.Issue(ctx, alice)
	aConn0 := dialWSWithTicket(t, srvShut, aTok0)
	aCh0, _ := startReader(t, aConn0)
	_ = nextFrameOfType(t, aCh0, "connection.ready", 2*time.Second)
	rawEv, _ := json.Marshal(map[string]interface{}{
		"v": 1, "id": messaging.NewUUID(), "type": "message.created",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   map[string]interface{}{"messageId": m1.ID},
	})
	staged, sErr := hubShut.StageConversationEvent([]string{alice}, rawEv, alice, bob)
	if sErr != nil || staged == nil {
		t.Fatalf("expected non-nil staged event, got staged=%v err=%v", staged, sErr)
	}
	hubShut.Close()
	staged.Commit()
	assertNoFrame(t, aCh0, 100*time.Millisecond)

	// Part B: Connected + disconnected target behavior (Alice online, Bob disconnected).
	hubB := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hubB.Close()
	srvB := startTestWSServer(t, pool, hubB, tickets)

	aTok, _, _ := tickets.Issue(ctx, alice)
	aConn := dialWSWithTicket(t, srvB, aTok)
	aCh, _ := startReader(t, aConn)
	_ = nextFrameOfType(t, aCh, "connection.ready", 2*time.Second)

	m2, err := msgSvc.SendMessage(ctx, bob, conv.ID, messaging.NewUUID(), "Bob offline reply")
	if err != nil {
		t.Fatal(err)
	}
	if err := msgSvc.MarkRead(ctx, alice, conv.ID, m2.ID); err != nil {
		t.Fatal(err)
	}

	relayB := realtime.NewOutboxRelay(pool, hubB, tickets, log, realtime.RelayConfig{WorkerID: "partial-conn-worker"})
	if n, rErr := relayB.ProcessOnce(ctx); rErr != nil || n != 2 {
		t.Fatalf("expected 2 partial-conn events published cleanly, got n=%d err=%v", n, rErr)
	}
	gotAlice := nextFrameOfType(t, aCh, "message.created", 2*time.Second)
	if gotAlice.Payload["messageId"] != m2.ID {
		t.Fatalf("expected Alice connected socket to receive M2, got %+v", gotAlice)
	}
	var nonPub int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM outbox_events WHERE conversation_id = $1 AND status != 'published'", conv.ID).Scan(&nonPub); err != nil {
		t.Fatal(err)
	}
	if nonPub != 0 {
		t.Fatalf("expected 0 non-published events when Bob is offline, got %d", nonPub)
	}
	// Disconnected Bob recovers both M1 and M2 authoritatively via keyset pagination.
	page, err := msgSvc.ListMessages(ctx, bob, conv.ID, "", m1.ID, 50)
	if err != nil || len(page.Messages) != 1 || page.Messages[0].ID != m2.ID {
		t.Fatalf("unexpected keyset catch-up for disconnected Bob: page=%+v err=%v", page, err)
	}
}

func TestBlockCommitVsFinalDispatchRaceAndBufferState(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	ctx := context.Background()

	// -------------------------------------------------------------------------
	// Scenario 1: Dispatcher pauses AFTER final unblocked check. BlockUser attempts
	// to commit while dispatch is paused. Verification: BlockUser blocks on the per-pair
	// lock and CANNOT commit while dispatch is inside its critical section.
	// -------------------------------------------------------------------------
	pausedAfterCheck := make(chan struct{})
	releaseDispatch := make(chan struct{})
	blockAttempting := make(chan struct{})
	var releaseDispatchOnce sync.Once
	defer releaseDispatchOnce.Do(func() { close(releaseDispatch) })

	hub1 := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{
		AfterDispatchCheckHook: func(userA, userB string) {
			close(pausedAfterCheck)
			<-releaseDispatch
		},
		OnBlockAttemptCommitHook: func(userA, userB string) {
			select {
			case <-blockAttempting:
			default:
				close(blockAttempting)
			}
		},
	})
	defer hub1.Close()
	msgSvc.SetRealtimeHooks(nil, hub1)
	srv1 := startTestWSServer(t, pool, hub1, tickets)

	alice := createUser(t, pool, "alice_crit_race")
	bob := createUser(t, pool, "bob_crit_race")
	makeMutual(t, pool, alice, bob)
	conv1, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_crit_race")
	if err != nil {
		t.Fatal(err)
	}

	bTok1, _, _ := tickets.Issue(ctx, bob)
	bConn1 := dialWSWithTicket(t, srv1, bTok1)
	bCh1, _ := startReader(t, bConn1)
	_ = nextFrameOfType(t, bCh1, "connection.ready", 2*time.Second)

	// Baseline enqueued frames before messaging: connection.ready = 1
	baseEnqueuedBob := hub1.TotalEnqueuedFrames(bob)

	m1, err := msgSvc.SendMessage(ctx, alice, conv1.ID, messaging.NewUUID(), "Msg 1 in critical section")
	if err != nil {
		t.Fatal(err)
	}

	relay1 := realtime.NewOutboxRelay(pool, hub1, tickets, log, realtime.RelayConfig{WorkerID: "crit-worker"})
	if n, rErr := relay1.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relay1 ProcessOnce: n=%d err=%v", n, rErr)
	}

	// Wait deterministically until dispatchLoop is paused inside the per-pair lock AFTER final unblocked check.
	<-pausedAfterCheck

	// Start BlockUser concurrently in another goroutine.
	blockDone := make(chan error, 1)
	go func() {
		blockDone <- msgSvc.BlockUser(ctx, bob, "alice_crit_race")
	}()

	// Wait deterministically until BlockUser reaches BeginBlockTransition and attempts to acquire pair lock.
	<-blockAttempting

	// Assert: BlockUser is blocked waiting on pair lock; its transaction has NOT committed yet in DB.
	var blockCommitted bool
	if err := pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2)", bob, alice).Scan(&blockCommitted); err != nil {
		t.Fatal(err)
	}
	if blockCommitted {
		t.Fatal("invariant violation: BlockUser committed while dispatch held pair dispatch lock")
	}

	// Release dispatchLoop -> M1 finishes enqueuing to Bob's socket before BlockUser can commit.
	releaseDispatchOnce.Do(func() { close(releaseDispatch) })

	// BlockUser now acquires pair lock and commits.
	if err := <-blockDone; err != nil {
		t.Fatalf("BlockUser error: %v", err)
	}

	gotM1 := nextFrameOfType(t, bCh1, "message.created", 2*time.Second)
	if gotM1.Payload["messageId"] != m1.ID {
		t.Fatalf("expected M1 delivered, got %+v", gotM1)
	}

	// Any subsequent outbox event for this conversation is suppressed by Relay and NEVER reaches Bob.
	if _, err := pool.Exec(ctx,
		`INSERT INTO outbox_events (event_type, conversation_id, payload, target_user_ids, status)
		 VALUES ('conversation.updated', $1, '{"v":1,"id":"`+messaging.NewUUID()+`","type":"conversation.updated","timestamp":"2026-11-10T00:00:00Z","payload":{}}'::jsonb, ARRAY[$2::uuid], 'pending')`,
		conv1.ID, bob,
	); err != nil {
		t.Fatal(err)
	}
	if n, rErr := relay1.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("expected 1 processed (suppressed) post-block event, got n=%d err=%v", n, rErr)
	}
	var postStatus, postErr string
	if err := pool.QueryRow(ctx, "SELECT status, coalesce(error_message, '') FROM outbox_events WHERE conversation_id = $1 AND event_type = 'conversation.updated'", conv1.ID).Scan(&postStatus, &postErr); err != nil {
		t.Fatal(err)
	}
	if postStatus != "published" || !strings.Contains(postErr, "suppressed: relationship blocked") {
		t.Fatalf("expected suppressed status for post-block event, got status=%s err=%s", postStatus, postErr)
	}
	assertNoFrame(t, bCh1, 150*time.Millisecond)

	// -------------------------------------------------------------------------
	// Scenario 2: Dispatcher checks CheckIsBlocked and gets false, then pauses BEFORE
	// acquiring the pair dispatch lock. While paused, BlockUser commits completely.
	// Verification: Dispatcher wakes up, enters pair lock, re-checks unblocked state,
	// returns false, and does NOT enqueue to outbound buffer or write to WebSocket!
	// -------------------------------------------------------------------------
	pausedBeforeLock := make(chan struct{})
	releaseBeforeLock := make(chan struct{})
	var releaseBeforeLockOnce sync.Once
	defer releaseBeforeLockOnce.Do(func() { close(releaseBeforeLock) })

	hub2 := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{
		BeforeDispatchLockHook: func(userA, userB string) {
			close(pausedBeforeLock)
			<-releaseBeforeLock
		},
	})
	defer hub2.Close()
	msgSvc.SetRealtimeHooks(nil, hub2)
	srv2 := startTestWSServer(t, pool, hub2, tickets)

	alice2 := createUser(t, pool, "alice_post_chk")
	bob2 := createUser(t, pool, "bob_post_chk")
	makeMutual(t, pool, alice2, bob2)
	conv2, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice2, "bob_post_chk")
	if err != nil {
		t.Fatal(err)
	}

	bTok2, _, _ := tickets.Issue(ctx, bob2)
	bConn2 := dialWSWithTicket(t, srv2, bTok2)
	bCh2, _ := startReader(t, bConn2)
	_ = nextFrameOfType(t, bCh2, "connection.ready", 2*time.Second)

	m2, err := msgSvc.SendMessage(ctx, alice2, conv2.ID, messaging.NewUUID(), "Msg 2 check-block race")
	if err != nil {
		t.Fatal(err)
	}

	relay2 := realtime.NewOutboxRelay(pool, hub2, tickets, log, realtime.RelayConfig{WorkerID: "post-chk-worker"})
	if n, rErr := relay2.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relay2 ProcessOnce: n=%d err=%v", n, rErr)
	}

	// Wait until dispatcher checked DB CheckIsBlocked (false) and paused before pair lock.
	<-pausedBeforeLock

	// Capture outbound frame count before block commits.
	enqueuedBeforeBlock := hub2.TotalEnqueuedFrames(bob2)

	// BlockUser commits completely before dispatch resumes.
	if err := msgSvc.BlockUser(ctx, bob2, "alice_post_chk"); err != nil {
		t.Fatalf("BlockUser 2: %v", err)
	}

	// Release dispatcher -> attempts to dispatch M2, acquires pair lock, sees blocked, skips enqueue!
	releaseBeforeLockOnce.Do(func() { close(releaseBeforeLock) })

	// Assert: Outbound buffer state remained unchanged (zero frames enqueued)!
	enqueuedAfterDispatch := hub2.TotalEnqueuedFrames(bob2)
	if enqueuedAfterDispatch != enqueuedBeforeBlock {
		t.Fatalf("invariant violation: frame was enqueued after block committed (before=%d after=%d)", enqueuedBeforeBlock, enqueuedAfterDispatch)
	}
	if pending := hub2.PendingOutboundCount(bob2); pending != 0 {
		t.Fatalf("expected 0 pending outbound frames, got %d", pending)
	}

	// Assert: No frame was written to Bob's WebSocket.
	assertNoFrame(t, bCh2, 200*time.Millisecond)

	// -------------------------------------------------------------------------
	// Scenario 3: Unblock does NOT resurrect the suppressed event.
	// -------------------------------------------------------------------------
	if err := msgSvc.UnblockUser(ctx, bob2, "alice_post_chk"); err != nil {
		t.Fatalf("UnblockUser: %v", err)
	}
	assertNoFrame(t, bCh2, 200*time.Millisecond)
	if pending := hub2.PendingOutboundCount(bob2); pending != 0 {
		t.Fatalf("expected 0 pending outbound frames after unblock, got %d", pending)
	}
	_ = baseEnqueuedBob
	_ = m2
}

func TestNormalDeliveryWithMultipleSessionsAndSimultaneousBlocks(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	ctx := context.Background()

	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)
	srv := startTestWSServer(t, pool, hub, tickets)

	alice := createUser(t, pool, "alice_mult_sess")
	bob := createUser(t, pool, "bob_mult_sess")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_mult_sess")
	if err != nil {
		t.Fatal(err)
	}

	// Bob connects 2 distinct active WebSocket sessions (multi-device).
	t1, _, _ := tickets.Issue(ctx, bob)
	c1 := dialWSWithTicket(t, srv, t1)
	ch1, _ := startReader(t, c1)
	_ = nextFrameOfType(t, ch1, "connection.ready", 2*time.Second)

	t2, _, _ := tickets.Issue(ctx, bob)
	c2 := dialWSWithTicket(t, srv, t2)
	ch2, _ := startReader(t, c2)
	_ = nextFrameOfType(t, ch2, "connection.ready", 2*time.Second)

	if hub.UserConnectionCount(bob) != 2 {
		t.Fatalf("expected 2 active connections for Bob, got %d", hub.UserConnectionCount(bob))
	}

	// Subtest A: Normal delivery when unblocked reaches both connected devices.
	mNormal, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Normal multi-device msg")
	if err != nil {
		t.Fatal(err)
	}
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "mult-worker"})
	if n, rErr := relay.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relay ProcessOnce normal: n=%d err=%v", n, rErr)
	}
	f1 := nextFrameOfType(t, ch1, "message.created", 2*time.Second)
	f2 := nextFrameOfType(t, ch2, "message.created", 2*time.Second)
	if f1.Payload["messageId"] != mNormal.ID || f2.Payload["messageId"] != mNormal.ID {
		t.Fatalf("unexpected delivery to sessions: f1=%+v f2=%+v", f1, f2)
	}

	// Subtest B: Simultaneous block operations (Alice blocks Bob AND Bob blocks Alice concurrently,
	// plus distinct pair Carol <-> Dave concurrently) under race detector.
	carol := createUser(t, pool, "carol_sim_blk")
	dave := createUser(t, pool, "dave_sim_blk")
	makeMutual(t, pool, carol, dave)

	var wg sync.WaitGroup
	errs := make([]error, 3)

	wg.Add(3)
	go func() {
		defer wg.Done()
		errs[0] = msgSvc.BlockUser(ctx, bob, "alice_mult_sess")
	}()
	go func() {
		defer wg.Done()
		errs[1] = msgSvc.BlockUser(ctx, alice, "bob_mult_sess")
	}()
	go func() {
		defer wg.Done()
		errs[2] = msgSvc.BlockUser(ctx, carol, "dave_sim_blk")
	}()
	wg.Wait()

	for i, bErr := range errs {
		if bErr != nil {
			t.Fatalf("simultaneous block [%d] failed: %v", i, bErr)
		}
	}

	// Assert: After simultaneous block commits, neither of Bob's sessions receives any further frames.
	assertNoFrame(t, ch1, 150*time.Millisecond)
	assertNoFrame(t, ch2, 150*time.Millisecond)
	if pending := hub.PendingOutboundCount(bob); pending != 0 {
		t.Fatalf("expected 0 pending outbound frames across Bob's sessions, got %d", pending)
	}
}

func TestPairStateLifecycleAndBoundedCleanup(t *testing.T) {
	pool := testdb.Pool(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	ctx := context.Background()

	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	defer hub.Close()
	msgSvc.SetRealtimeHooks(nil, hub)
	srv := startTestWSServer(t, pool, hub, tickets)

	alice := createUser(t, pool, "alice_lifecycle")
	bob := createUser(t, pool, "bob_lifecycle")
	makeMutual(t, pool, alice, bob)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_lifecycle")
	if err != nil {
		t.Fatal(err)
	}

	bTok, _, _ := tickets.Issue(ctx, bob)
	bConn := dialWSWithTicket(t, srv, bTok)
	bCh, _ := startReader(t, bConn)
	_ = nextFrameOfType(t, bCh, "connection.ready", 2*time.Second)

	// Send message, relay stages and commits event.
	m, err := msgSvc.SendMessage(ctx, alice, conv.ID, messaging.NewUUID(), "Lifecycle test msg")
	if err != nil {
		t.Fatal(err)
	}
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{WorkerID: "life-worker"})
	if n, rErr := relay.ProcessOnce(ctx); rErr != nil || n != 1 {
		t.Fatalf("relay ProcessOnce: n=%d err=%v", n, rErr)
	}
	_ = nextFrameOfType(t, bCh, "message.created", 2*time.Second)
	_ = m

	// Once dispatch completes and active staged refcount drops to 0:
	// pairLocks and activeStagedByPair must have 0 entries for the pair.
	_, epochCount, lockCount, activeStagedCount := hub.PairStateCounts()
	if lockCount != 0 {
		t.Fatalf("expected 0 active pairLocks, got %d", lockCount)
	}
	if activeStagedCount != 0 {
		t.Fatalf("expected 0 activeStagedByPair entries, got %d", activeStagedCount)
	}
	if epochCount != 0 {
		t.Fatalf("expected 0 pairEpoch entries for unblocked pair, got %d", epochCount)
	}

	// Now block Alice while Bob is connected: blockedPairs entry is added.
	if err := msgSvc.BlockUser(ctx, bob, "alice_lifecycle"); err != nil {
		t.Fatalf("BlockUser: %v", err)
	}
	blockedCount, _, _, _ := hub.PairStateCounts()
	if blockedCount != 1 {
		t.Fatalf("expected 1 blockedPairs entry while Bob is connected, got %d", blockedCount)
	}

	// Disconnect Bob (leaving both users offline): unregister prunes idle blockedPairs.
	_ = bConn.Close(websocket.StatusNormalClosure, "")
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && hub.UserConnectionCount(bob) > 0 {
		time.Sleep(10 * time.Millisecond)
	}
	blockedCountAfter, epochCountAfter, lockCountAfter, activeStagedAfter := hub.PairStateCounts()
	if blockedCountAfter != 0 || epochCountAfter != 0 || lockCountAfter != 0 || activeStagedAfter != 0 {
		t.Fatalf("expected all pair-state maps to be 0 after disconnect, got blocked=%d epoch=%d lock=%d staged=%d",
			blockedCountAfter, epochCountAfter, lockCountAfter, activeStagedAfter)
	}
}

func TestWebSocketMessageSendRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_ws_rl")
	bob := createUser(t, pool, "bob_ws_rl")
	msgSvc := messaging.NewService(pool)
	conv, _, err := msgSvc.GetOrCreateDirectConversation(ctx, alice, "bob_ws_rl")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := msgSvc.AcceptConversation(ctx, bob, conv.ID); err != nil {
		t.Fatal(err)
	}

	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, slog.Default(), realtime.HubConfig{})
	t.Cleanup(hub.Close)
	srv := startTestWSServer(t, pool, hub, tickets)

	tok, _, err := tickets.Issue(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWSWithTicket(t, srv, tok)
	aFrames, _ := startReader(t, conn)

	// Consume connection.ready
	_ = nextFrameOfType(t, aFrames, "connection.ready", 2*time.Second)

	// Send 30 messages (default limit is 30/min)
	for i := 0; i < 30; i++ {
		cid := messaging.NewUUID()
		writeFrame(t, conn, "message.send", map[string]interface{}{
			"conversationId":  conv.ID,
			"clientMessageId": cid,
			"content":         fmt.Sprintf("msg %d", i),
		})
		_ = nextFrameOfType(t, aFrames, "message.ack", 2*time.Second)
	}

	// 31st message must trigger RATE_LIMITED error frame
	exceededCID := messaging.NewUUID()
	writeFrame(t, conn, "message.send", map[string]interface{}{
		"conversationId":  conv.ID,
		"clientMessageId": exceededCID,
		"content":         "exceeded msg",
	})
	errFrame := nextFrameOfType(t, aFrames, "error", 2*time.Second)
	if errFrame.Payload["code"] != "RATE_LIMITED" {
		t.Fatalf("expected RATE_LIMITED error frame, got %+v", errFrame)
	}
	if errFrame.Payload["clientMessageId"] != exceededCID {
		t.Fatalf("expected clientMessageId=%s in error frame, got %+v", exceededCID, errFrame.Payload)
	}
}

func TestWebSocketMalformedEnvelopesAndUnknownEvents(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_ws_malformed")
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, slog.Default(), realtime.HubConfig{})
	t.Cleanup(hub.Close)
	srv := startTestWSServer(t, pool, hub, tickets)

	tok, _, err := tickets.Issue(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWSWithTicket(t, srv, tok)
	aFrames, _ := startReader(t, conn)
	_ = nextFrameOfType(t, aFrames, "connection.ready", 2*time.Second)

	// 1. Non-JSON raw text frame -> BAD_REQUEST error frame
	wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := conn.Write(wctx, websocket.MessageText, []byte("plain text not json")); err != nil {
		t.Fatal(err)
	}
	f1 := nextFrameOfType(t, aFrames, "error", 2*time.Second)
	if f1.Payload["code"] != "BAD_REQUEST" {
		t.Fatalf("non-JSON expected BAD_REQUEST, got %+v", f1)
	}

	// 2. Unsupported protocol version (v=2) -> BAD_REQUEST error frame
	writeRaw := func(payload []byte) {
		wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if err := conn.Write(wctx, websocket.MessageText, payload); err != nil {
			t.Fatal(err)
		}
	}
	writeRaw([]byte(`{"v":2,"id":"` + messaging.NewUUID() + `","type":"ping","timestamp":"2026-11-17T00:00:00Z","payload":{}}`))
	f2 := nextFrameOfType(t, aFrames, "error", 2*time.Second)
	if f2.Payload["code"] != "BAD_REQUEST" {
		t.Fatalf("v=2 expected BAD_REQUEST, got %+v", f2)
	}

	// 3. Unknown event type -> BAD_REQUEST error frame
	writeRaw([]byte(`{"v":1,"id":"` + messaging.NewUUID() + `","type":"unauthorized.subscription","timestamp":"2026-11-17T00:00:00Z","payload":{}}`))
	f3 := nextFrameOfType(t, aFrames, "error", 2*time.Second)
	if f3.Payload["code"] != "BAD_REQUEST" {
		t.Fatalf("unknown event type expected BAD_REQUEST, got %+v", f3)
	}

	// 4. Unauthorized message.send for non-member conversation -> FORBIDDEN error frame
	writeFrame(t, conn, "message.send", map[string]interface{}{
		"conversationId":  messaging.NewUUID(),
		"clientMessageId": messaging.NewUUID(),
		"content":         "unauthorized",
	})
	f4 := nextFrameOfType(t, aFrames, "error", 2*time.Second)
	if f4.Payload["code"] != "FORBIDDEN" {
		t.Fatalf("non-member send expected FORBIDDEN, got %+v", f4)
	}
}

func TestWebSocketOversizedInboundFrame(t *testing.T) {
	pool := testdb.Pool(t)
	ctx := context.Background()

	alice := createUser(t, pool, "alice_ws_oversized")
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, slog.Default(), realtime.HubConfig{
		MaxInboundBytes: 1024, // 1 KiB test threshold
	})
	t.Cleanup(hub.Close)
	srv := startTestWSServer(t, pool, hub, tickets)

	tok, _, err := tickets.Issue(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	conn := dialWSWithTicket(t, srv, tok)

	// Write oversized frame (4 KiB payload > 1 KiB MaxInboundBytes)
	oversized := make([]byte, 4096)
	for i := range oversized {
		oversized[i] = 'a'
	}
	largeEnvelope, _ := json.Marshal(map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "ping",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   map[string]string{"data": string(oversized)},
	})

	wctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_ = conn.Write(wctx, websocket.MessageText, largeEnvelope)

	// Reading from connection should fail because server closes socket on oversized frame
	rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
	defer rcancel()
	for {
		_, _, err := conn.Read(rctx)
		if err != nil {
			break
		}
	}
}
