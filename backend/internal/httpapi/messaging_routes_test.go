package httpapi

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/Cholan-kinnera/holoraa/backend/internal/auth"
	"github.com/Cholan-kinnera/holoraa/backend/internal/health"
	"github.com/Cholan-kinnera/holoraa/backend/internal/logging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/profile"
	"github.com/Cholan-kinnera/holoraa/backend/internal/testdb"
)

func TestMessagingRoutesConversationsAndMessages(t *testing.T) {
	f := newAuthFixture(t)

	// Set up two users
	aliceCookie := f.signIn(t, "alice-http@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": aliceCSRF,
	}

	bobCookie := f.signIn(t, "bob-http@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": bobCSRF,
	}

	// Claim usernames
	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_http","displayName":"Alice"}`, aliceHeaders, aliceCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_http","displayName":"Bob"}`, bobHeaders, bobCookie)

	// 1. Create direct conversation (non-mutual follow -> 201 Created with status "pending")
	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_http"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/conversations/direct: %d %s", rec.Code, rec.Body.String())
	}
	var conv messaging.Conversation
	if err := json.Unmarshal(rec.Body.Bytes(), &conv); err != nil {
		t.Fatalf("unmarshal conv: %v", err)
	}
	if conv.Status != "pending" || conv.Peer.Username != "bob_http" {
		t.Fatalf("unexpected conv: %+v", conv)
	}

	// 2. Idempotent retrieval (200 OK)
	rec = f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_http"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /v1/conversations/direct idempotent: %d", rec.Code)
	}

	// 3. List conversations for Alice
	rec = f.do(http.MethodGet, "/v1/conversations", "", nil, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/conversations: %d", rec.Code)
	}
	var listResp struct {
		Conversations []messaging.Conversation `json:"conversations"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("unmarshal list: %v", err)
	}
	if len(listResp.Conversations) != 1 || listResp.Conversations[0].ID != conv.ID {
		t.Fatalf("unexpected list: %+v", listResp)
	}

	// 4. Get single conversation
	rec = f.do(http.MethodGet, "/v1/conversations/"+conv.ID, "", nil, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/conversations/{id}: %d", rec.Code)
	}

	// 5. Send message in pending conversation (1 allowed)
	clientMsg1 := messaging.NewUUID()
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages", fmt.Sprintf(`{"clientMessageId":"%s","content":"Hi Bob!"}`, clientMsg1), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/conversations/{id}/messages: %d %s", rec.Code, rec.Body.String())
	}
	var msg1 messaging.Message
	if err := json.Unmarshal(rec.Body.Bytes(), &msg1); err != nil {
		t.Fatalf("unmarshal message: %v", err)
	}
	if msg1.SequenceNum != 1 {
		t.Fatalf("expected sequence 1, got %d", msg1.SequenceNum)
	}

	// 6. Second message from initiator before accept is rejected (403 Forbidden)
	clientMsg2 := messaging.NewUUID()
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages", fmt.Sprintf(`{"clientMessageId":"%s","content":"Second message"}`, clientMsg2), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST second message in pending: %d, want 403", rec.Code)
	}

	// 7. Bob accepts the conversation (200 OK)
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/accept", "", bobHeaders, bobCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /v1/conversations/{id}/accept: %d %s", rec.Code, rec.Body.String())
	}

	// 8. Bob marks delivered (204 No Content)
	rec = f.do(http.MethodPost, fmt.Sprintf("/v1/conversations/%s/messages/%s/delivered", conv.ID, msg1.ID), "", bobHeaders, bobCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST delivered: %d", rec.Code)
	}

	// 9. Bob marks read (204 No Content)
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/read", fmt.Sprintf(`{"messageId":"%s"}`, msg1.ID), bobHeaders, bobCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST read: %d", rec.Code)
	}

	// 10. List messages with pagination
	rec = f.do(http.MethodGet, "/v1/conversations/"+conv.ID+"/messages?limit=10", "", nil, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/conversations/{id}/messages: %d", rec.Code)
	}
	var page messaging.MessagesPage
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil {
		t.Fatalf("unmarshal page: %v", err)
	}
	if len(page.Messages) != 1 || page.Messages[0].ID != msg1.ID {
		t.Fatalf("unexpected messages: %+v", page)
	}

	// 11. Settings GET & PATCH
	rec = f.do(http.MethodGet, "/v1/me/settings", "", nil, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/me/settings: %d", rec.Code)
	}
	var settings messaging.UserSettings
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatalf("unmarshal settings: %v", err)
	}
	if !settings.ReadReceiptsEnabled {
		t.Fatalf("expected default readReceiptsEnabled=true")
	}

	rec = f.do(http.MethodPatch, "/v1/me/settings", `{"readReceiptsEnabled":false}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH /v1/me/settings: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatalf("unmarshal settings: %v", err)
	}
	if settings.ReadReceiptsEnabled {
		t.Fatalf("expected readReceiptsEnabled=false after patch")
	}

	// 12. Block and Unblock
	rec = f.do(http.MethodPost, "/v1/users/bob_http/block", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("POST /v1/users/{username}/block: %d", rec.Code)
	}

	rec = f.do(http.MethodDelete, "/v1/users/bob_http/block", "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE /v1/users/{username}/block: %d", rec.Code)
	}
}

func TestMessagingRoutesSecurityAndValidation(t *testing.T) {
	f := newAuthFixture(t)

	// 1. Unauthenticated requests fail with 401 Unauthorized
	unauthRoutes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/v1/conversations"},
		{http.MethodPost, "/v1/conversations/direct"},
		{http.MethodGet, "/v1/conversations/00000000-0000-0000-0000-000000000001"},
		{http.MethodPost, "/v1/conversations/00000000-0000-0000-0000-000000000001/messages"},
		{http.MethodGet, "/v1/conversations/00000000-0000-0000-0000-000000000001/messages"},
		{http.MethodPost, "/v1/conversations/00000000-0000-0000-0000-000000000001/read"},
		{http.MethodGet, "/v1/me/settings"},
		{http.MethodPatch, "/v1/me/settings"},
		{http.MethodPost, "/v1/users/someone/block"},
		{http.MethodDelete, "/v1/users/someone/block"},
	}

	for _, tc := range unauthRoutes {
		headers := map[string]string{"Origin": testOrigin}
		rec := f.do(tc.method, tc.path, "", headers, nil)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without auth: %d, want 401", tc.method, tc.path, rec.Code)
		}
	}

	cookie := f.signIn(t, "security-test@example.test")
	csrf := f.csrf(t, cookie)

	// 2. State-changing routes require Origin and CSRF
	noOrigin := map[string]string{
		"Content-Type": jsonCT,
		"X-CSRF-Token": csrf,
	}
	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"someone"}`, noOrigin, cookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST without origin: %d, want 403", rec.Code)
	}

	noCSRF := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
	}
	rec = f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"someone"}`, noCSRF, cookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST without CSRF: %d, want 403", rec.Code)
	}

	validHeaders := map[string]string{
		"Origin":       testOrigin,
		"Content-Type": jsonCT,
		"X-CSRF-Token": csrf,
	}

	// 3. Invalid UUIDs in path return 400 Bad Request
	rec = f.do(http.MethodGet, "/v1/conversations/not-a-uuid", "", nil, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("GET /v1/conversations/not-a-uuid: %d, want 400", rec.Code)
	}

	// 4. Unknown fields rejected
	rec = f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"someone","unknown":"field"}`, validHeaders, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST unknown field: %d, want 400", rec.Code)
	}

	// 5. Missing required readReceiptsEnabled in PATCH /v1/me/settings returns 400
	rec = f.do(http.MethodPatch, "/v1/me/settings", `{}`, validHeaders, cookie)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("PATCH /v1/me/settings with empty object: %d, want 400", rec.Code)
	}
}

func TestMessagingRoutesAuthorizationRegression(t *testing.T) {
	f := newAuthFixture(t)

	aliceCookie := f.signIn(t, "alice-authz@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}

	bobCookie := f.signIn(t, "bob-authz@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": bobCSRF}

	eveCookie := f.signIn(t, "eve-authz@example.test")
	eveCSRF := f.csrf(t, eveCookie)
	eveHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": eveCSRF}

	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_http_az"}`, aliceHeaders, aliceCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_http_az"}`, bobHeaders, bobCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"eve_http_az"}`, eveHeaders, eveCookie)

	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_http_az"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create conv: %d %s", rec.Code, rec.Body.String())
	}
	var conv messaging.Conversation
	_ = json.Unmarshal(rec.Body.Bytes(), &conv)

	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages", fmt.Sprintf(`{"clientMessageId":"%s","content":"hello"}`, messaging.NewUUID()), aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("send msg: %d %s", rec.Code, rec.Body.String())
	}
	var msg messaging.Message
	_ = json.Unmarshal(rec.Body.Bytes(), &msg)

	// Sender cannot acknowledge own message as delivered -> 403 Forbidden.
	rec = f.do(http.MethodPost, fmt.Sprintf("/v1/conversations/%s/messages/%s/delivered", conv.ID, msg.ID), "", aliceHeaders, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("sender POST delivered on own msg: %d, want 403", rec.Code)
	}

	// Non-member cannot probe messages via MarkRead (random UUID or real UUID both return 403).
	rec = f.do(http.MethodPost, fmt.Sprintf("/v1/conversations/%s/read", conv.ID), fmt.Sprintf(`{"messageId":"%s"}`, messaging.NewUUID()), eveHeaders, eveCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-member POST read random uuid: %d, want 403", rec.Code)
	}
	rec = f.do(http.MethodPost, fmt.Sprintf("/v1/conversations/%s/read", conv.ID), fmt.Sprintf(`{"messageId":"%s"}`, msg.ID), eveHeaders, eveCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-member POST read real uuid: %d, want 403", rec.Code)
	}
}

func TestMessagingRoutesDeclinedPolicy(t *testing.T) {
	f := newAuthFixture(t)

	aliceCookie := f.signIn(t, "alice-dec@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}

	bobCookie := f.signIn(t, "bob-dec@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": bobCSRF}

	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_dec_http"}`, aliceHeaders, aliceCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_dec_http"}`, bobHeaders, bobCookie)

	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_dec_http"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create conv: %d %s", rec.Code, rec.Body.String())
	}
	var conv messaging.Conversation
	_ = json.Unmarshal(rec.Body.Bytes(), &conv)

	rec = f.do(http.MethodPost, fmt.Sprintf("/v1/conversations/%s/decline", conv.ID), "", bobHeaders, bobCookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("decline conv: %d %s", rec.Code, rec.Body.String())
	}

	// Both users get 403 Forbidden on POST /v1/conversations/direct when declined.
	rec = f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_dec_http"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("alice POST /conversations/direct after decline: %d, want 403", rec.Code)
	}
	rec = f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"alice_dec_http"}`, bobHeaders, bobCookie)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("bob POST /conversations/direct after decline: %d, want 403", rec.Code)
	}

	// GET /v1/conversations and GET /v1/conversations/{id} still expose declined status to both participants.
	for _, c := range []*http.Cookie{aliceCookie, bobCookie} {
		rec = f.do(http.MethodGet, "/v1/conversations/"+conv.ID, "", nil, c)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /conversations/{id}: %d", rec.Code)
		}
		var got messaging.Conversation
		_ = json.Unmarshal(rec.Body.Bytes(), &got)
		if got.Status != "declined" {
			t.Fatalf("expected status=declined, got %s", got.Status)
		}

		rec = f.do(http.MethodGet, "/v1/conversations", "", nil, c)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET /conversations: %d", rec.Code)
		}
		var list struct {
			Conversations []messaging.Conversation `json:"conversations"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &list)
		if len(list.Conversations) != 1 || list.Conversations[0].Status != "declined" {
			t.Fatalf("expected declined conversation in list, got %+v", list)
		}
	}
}

func TestMessagingRouteRateLimiting(t *testing.T) {
	pool := testdb.Pool(t)
	log := logging.New(io.Discard, slog.LevelError)
	sender := &memSender{}
	authSvc := auth.New(pool, []byte(testSecret), sender, rand.Reader)
	msgSvc := messaging.NewService(pool)
	limiter := NewSlidingLimiter(2, time.Minute)

	h := NewRouter(Deps{
		Log:            log,
		Health:         health.New(pool, time.Second, log),
		Auth:           authSvc,
		Profiles:       profile.NewRepo(pool),
		Messaging:      msgSvc,
		MessageLimiter: limiter,
		Security:       Security{CookieName: testCookieName, CookieSecure: true, AllowedOrigins: []string{testOrigin}},
	})
	f := authFixture{pool: pool, h: h, mail: sender, auth: authSvc}

	aliceCookie := f.signIn(t, "alice-ratelimit@example.test")
	aliceCSRF := f.csrf(t, aliceCookie)
	aliceHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": aliceCSRF}

	bobCookie := f.signIn(t, "bob-ratelimit@example.test")
	bobCSRF := f.csrf(t, bobCookie)
	bobHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, "X-CSRF-Token": bobCSRF}

	f.do(http.MethodPatch, "/v1/me", `{"username":"alice_rl"}`, aliceHeaders, aliceCookie)
	f.do(http.MethodPatch, "/v1/me", `{"username":"bob_rl"}`, bobHeaders, bobCookie)

	// Create conversation and accept it so pending limit is not hit
	rec := f.do(http.MethodPost, "/v1/conversations/direct", `{"targetUsername":"bob_rl"}`, aliceHeaders, aliceCookie)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create conv: %d %s", rec.Code, rec.Body.String())
	}
	var conv messaging.Conversation
	_ = json.Unmarshal(rec.Body.Bytes(), &conv)
	f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/accept", "", bobHeaders, bobCookie)

	// First 2 sends within limit -> 201 Created
	for i := 0; i < 2; i++ {
		rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages",
			fmt.Sprintf(`{"clientMessageId":"%s","content":"msg %d"}`, messaging.NewUUID(), i),
			aliceHeaders, aliceCookie)
		if rec.Code != http.StatusCreated {
			t.Fatalf("send %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}

	// 3rd send exceeds limit -> 429 Too Many Requests
	rec = f.do(http.MethodPost, "/v1/conversations/"+conv.ID+"/messages",
		fmt.Sprintf(`{"clientMessageId":"%s","content":"msg 3"}`, messaging.NewUUID()),
		aliceHeaders, aliceCookie)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("3rd send beyond limit: %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on 429 response")
	}
	if got := rec.Header().Get("Content-Type"); got != "application/problem+json" {
		t.Fatalf("expected problem+json, got %q", got)
	}
}
