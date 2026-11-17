package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
	"github.com/Cholan-kinnera/holoraa/backend/internal/realtime"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type realtimeFixture struct {
	authFixture
	srv      *httptest.Server
	hub      *realtime.Hub
	tickets  *realtime.TicketService
	relay    *realtime.OutboxRelay
	safeLogs *syncBuffer
}

func newRealtimeFixture(t *testing.T) realtimeFixture {
	t.Helper()
	pool := testdb.Pool(t)
	safeLogs := &syncBuffer{}
	log := slog.New(slog.NewJSONHandler(safeLogs, nil))
	sender := &memSender{}
	authSvc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	msgSvc := messaging.NewService(pool)
	tickets := realtime.NewTicketService(pool)
	hub := realtime.NewHub(pool, msgSvc, log, realtime.HubConfig{})
	relay := realtime.NewOutboxRelay(pool, hub, tickets, log, realtime.RelayConfig{PollInterval: 25 * time.Millisecond})
	hub.SetRelayNotifier(relay)
	msgSvc.SetRealtimeHooks(relay, hub)

	relayCtx, relayCancel := context.WithCancel(context.Background())
	relayDone := make(chan struct{})
	go func() {
		defer close(relayDone)
		relay.Run(relayCtx)
	}()

	router := NewRouter(Deps{
		Log:       log,
		Health:    health.New(pool, time.Second, log),
		Auth:      authSvc,
		Profiles:  profile.NewRepo(pool),
		Messaging: msgSvc,
		Tickets:   tickets,
		Hub:       hub,
		Security:  Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
	})
	srv := httptest.NewServer(router)
	t.Cleanup(func() {
		relayCancel()
		hub.Close()
		<-relayDone
		srv.Close()
	})

	return realtimeFixture{
		authFixture: authFixture{pool: pool, h: router, mail: sender, auth: authSvc},
		srv:         srv,
		hub:         hub,
		tickets:     tickets,
		relay:       relay,
		safeLogs:    safeLogs,
	}
}

func (f realtimeFixture) issueTicket(t *testing.T, cookie *http.Cookie, csrf string) string {
	t.Helper()
	headers := map[string]string{"Origin": testOrigin, "X-CSRF-Token": csrf}
	rec := f.do(http.MethodPost, "/v1/realtime/ticket", "", headers, cookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/realtime/ticket: %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Ticket    string `json:"ticket"`
		ExpiresIn int    `json:"expiresIn"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.ExpiresIn != 60 || len(resp.Ticket) < 32 {
		t.Fatalf("unexpected ticket response: %+v", resp)
	}
	return resp.Ticket
}

func TestRealtimeRoutesAuthOriginAndRedaction(t *testing.T) {
	f := newRealtimeFixture(t)

	// 1. Unauthenticated ticket issuance fails closed.
	rec := f.do(http.MethodPost, "/v1/realtime/ticket", "", map[string]string{"Origin": testOrigin}, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("POST /v1/realtime/ticket unauthenticated: %d, want 401", rec.Code)
	}

	aliceCookie := f.signIn(t, "alice-rt-sec@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)

	// Missing CSRF on /v1/realtime/ticket fails 403.
	rec = f.do(http.MethodPost, "/v1/realtime/ticket", "", map[string]string{"Origin": testOrigin}, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST /v1/realtime/ticket without CSRF: %d, want 403", rec.Code)
	}

	ticket := f.issueTicket(t, aliceCookie, aliceCSRF)

	wsURL := "ws" + strings.TrimPrefix(f.srv.URL, "http") + "/v1/realtime/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 2. Disallowed Origin rejected with 403 BEFORE ticket consumption!
	_, respEvil, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{"https://evil.example.com"}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticket},
	})
	if err == nil || respEvil == nil || respEvil.StatusCode != http.StatusForbidden {
		t.Fatalf("evil origin expected 403, got resp=%v err=%v", respEvil, err)
	}

	// 3. Session cookie or ?session= without valid ticket MUST be rejected with 401 (never accepted as WS auth).
	_, respCookieOnly, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{testOrigin},
			"Cookie": []string{aliceCookie.Name + "=" + aliceCookie.Value},
		},
	})
	if err == nil || respCookieOnly == nil || respCookieOnly.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cookie-only WS upgrade expected 401, got resp=%v err=%v", respCookieOnly, err)
	}

	_, respSessQuery, err := websocket.Dial(ctx, wsURL+"?session="+aliceCookie.Value, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{testOrigin}},
	})
	if err == nil || respSessQuery == nil || respSessQuery.StatusCode != http.StatusUnauthorized {
		t.Fatalf("session query WS upgrade expected 401, got resp=%v err=%v", respSessQuery, err)
	}

	// 4. Same ticket STILL works with valid Origin (proving step 2 did not burn it!).
	conn, respOK, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticket},
	})
	if err != nil {
		t.Fatalf("valid WS dial failed: %v", err)
	}
	defer conn.Close(websocket.StatusNormalClosure, "")
	if respOK.Header.Get("Sec-WebSocket-Protocol") != realtime.SubprotocolBase {
		t.Fatalf("unexpected subprotocol echo: %q", respOK.Header.Get("Sec-WebSocket-Protocol"))
	}

	// 5. Replaying same ticket fails with 401.
	_, respReplay, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticket},
	})
	if err == nil || respReplay == nil || respReplay.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ticket replay expected 401, got resp=%v err=%v", respReplay, err)
	}

	// 6. Query-string ticket (?ticket=...) MUST be strictly rejected with 401 (never accepted as fallback),
	// leave the ticket unconsumed, and never leak any ticket into logs.
	ticketStrict := f.issueTicket(t, aliceCookie, aliceCSRF)
	_, respQueryRejected, err := websocket.Dial(ctx, wsURL+"?ticket="+ticketStrict, &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{testOrigin}},
	})
	if err == nil || respQueryRejected == nil || respQueryRejected.StatusCode != http.StatusUnauthorized {
		t.Fatalf("query-string ?ticket= expected 401, got resp=%v err=%v", respQueryRejected, err)
	}
	// Even with Sec-WebSocket-Protocol present, passing ?ticket= query param is rejected.
	_, respQueryMixed, err := websocket.Dial(ctx, wsURL+"?ticket="+ticketStrict, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticketStrict},
	})
	if err == nil || respQueryMixed == nil || respQueryMixed.StatusCode != http.StatusUnauthorized {
		t.Fatalf("mixed query-string ?ticket= expected 401, got resp=%v err=%v", respQueryMixed, err)
	}

	// Clean Sec-WebSocket-Protocol dial with ticketStrict still succeeds and never echoes ticket.
	conn2, resp2, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + ticketStrict},
	})
	if err != nil {
		t.Fatalf("subprotocol ticket dial failed: %v", err)
	}
	if resp2.Header.Get("Sec-WebSocket-Protocol") != realtime.SubprotocolBase {
		t.Fatalf("unexpected subprotocol echo: %q", resp2.Header.Get("Sec-WebSocket-Protocol"))
	}
	_ = conn2.Close(websocket.StatusNormalClosure, "")

	logDump := f.safeLogs.String()
	if strings.Contains(logDump, ticket) || strings.Contains(logDump, ticketStrict) {
		t.Fatalf("secret ticket leaked into server logs!")
	}
}

func TestRealtimeRoutesDisconnectReconnectCatchup(t *testing.T) {
	f := newRealtimeFixture(t)

	aliceCookie := f.signIn(t, "alice-rec@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}

	bobCookie := f.signIn(t, "bob-rec@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": bobCSRF}

	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_ws_rec"}`, aliceHeaders, aliceCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_ws_rec"}`, bobHeaders, bobCookie)
	f.do(http.MethodPost, "/v1/users/bob_ws_rec/follow", "", aliceHeaders, aliceCookie)
	f.do(http.MethodPost, "/v1/users/alice_ws_rec/follow", "", bobHeaders, bobCookie)

	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_ws_rec"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create conv: %d %s", rec.Code, rec.Body.String())
	}
	var conv messaging.Conversation
	_ = json.Unmarshal(rec.Body.Bytes(), &conv)

	wsURL := "ws" + strings.TrimPrefix(f.srv.URL, "http") + "/v1/realtime/ws"
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Bob connects, receives message 1 over WS, then disconnects.
	bTicket1 := f.issueTicket(t, bobCookie, bobCSRF)
	bConn1, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + bTicket1},
	})
	if err != nil {
		t.Fatalf("bob ws dial 1: %v", err)
	}
	_, _, _ = bConn1.Read(ctx) // connection.ready

	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages",
		fmt.Sprintf(`{"clientMessageId":"%s","content":"Msg 1 online"}`, messaging.NewUUID()), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("send msg 1: %d", rec.Code)
	}
	var m1 messaging.Message
	_ = json.Unmarshal(rec.Body.Bytes(), &m1)

	_, rawM1, err := bConn1.Read(ctx)
	if err != nil {
		t.Fatalf("bob read m1 over ws: %v", err)
	}
	if !strings.Contains(string(rawM1), m1.ID) {
		t.Fatalf("expected msg1 ID over WS, got %s", string(rawM1))
	}

	// Bob goes offline.
	_ = bConn1.Close(websocket.StatusNormalClosure, "offline")

	// Alice sends msg 2 & msg 3 while Bob is disconnected.
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages",
		fmt.Sprintf(`{"clientMessageId":"%s","content":"Msg 2 offline"}`, messaging.NewUUID()), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("send msg 2: %d", rec.Code)
	}
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages",
		fmt.Sprintf(`{"clientMessageId":"%s","content":"Msg 3 offline"}`, messaging.NewUUID()), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("send msg 3: %d", rec.Code)
	}

	// Bob reconnects with a fresh ticket and catches up missed messages via REST keyset ?after=m1.ID.
	bTicket2 := f.issueTicket(t, bobCookie, bobCSRF)
	bConn2, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{testOrigin}},
		Subprotocols: []string{realtime.SubprotocolBase, realtime.TicketSubprotocolPrefix + bTicket2},
	})
	if err != nil {
		t.Fatalf("bob ws dial 2: %v", err)
	}
	defer bConn2.Close(websocket.StatusNormalClosure, "")
	_, readyRaw, err := bConn2.Read(ctx)
	if err != nil || !strings.Contains(string(readyRaw), "connection.ready") {
		t.Fatalf("expected connection.ready on reconnect, got %q err=%v", string(readyRaw), err)
	}

	rec = f.do(http.MethodGet, fmt.Sprintf("/v1/conversations/%s/messages?after=%s&limit=50", conv.ID, m1.ID), "", nil, bobCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET catchup messages: %d %s", rec.Code, rec.Body.String())
	}
	var page messaging.MessagesPage
	_ = json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Messages) != 2 || page.Messages[0].SequenceNum != 2 || page.Messages[1].SequenceNum != 3 {
		t.Fatalf("unexpected catchup page: %+v", page)
	}
}

func TestTicketIssuanceRateLimiting(t *testing.T) {
	f := newRealtimeFixture(t)
	cookie := f.signIn(t, "ticket-limit@example.test")
	csrf := f.csrf(t, cookie)
	headers := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": csrf,
	}

	// First 10 ticket requests succeed (TicketLimiter defaults to 10/min)
	for i := 0; i < 10; i++ {
		rec := f.do(http.MethodPost, "/v1/realtime/ticket", "{}", headers, cookie)
		if rec.Code != http.StatusCreated {
			t.Fatalf("ticket %d: expected 201 Created, got %d %s", i+1, rec.Code, rec.Body.String())
		}
	}

	// 11th ticket request hits rate limit
	rec := f.do(http.MethodPost, "/v1/realtime/ticket", "{}", headers, cookie)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("11th ticket request: expected 429 Too Many Requests, got %d %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on 429 response")
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("expected problem+json, got %q", got)
	}
}
