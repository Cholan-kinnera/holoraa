package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
)

const (
	defaultHubQueueSize      = 1024
	defaultSendBufferSize    = 64
	defaultWriteTimeout      = 5 * time.Second
	defaultHeartbeatInterval = 30 * time.Second
	defaultIdleTimeout       = 60 * time.Second
	defaultTypingTTL         = 5 * time.Second
	defaultMaxInboundBytes   = 16 << 10 // 16 KiB per PRD § 6.4
	defaultWSSendLimit       = 30       // 30 msgs/min per PRD FR-11
	defaultWSSendWindow      = time.Minute
)

var (
	// ErrHubQueueFull indicates the hub's bounded in-memory dispatch queue is saturated.
	ErrHubQueueFull = errors.New("realtime hub queue is full")
	// ErrHubClosed indicates the hub is shutting down and can no longer accept events.
	ErrHubClosed = errors.New("realtime hub is closed")
)

// HubConfig configures WebSocket connection management, timeouts, and backpressure limits.
type HubConfig struct {
	QueueSize         int
	SendBufferSize    int
	WriteTimeout      time.Duration
	HeartbeatInterval time.Duration
	IdleTimeout       time.Duration
	TypingTTL         time.Duration
	MaxInboundBytes   int64
	// DispatchGate is an optional barrier channel (closed to release dispatchLoop); nil in production.
	DispatchGate <-chan struct{}
	// Optional deterministic concurrency hooks (nil in production).
	BeforeDispatchLockHook   func(userA, userB string)
	AfterDispatchCheckHook   func(userA, userB string)
	OnBlockAttemptCommitHook func(userA, userB string)
}

func (c HubConfig) withDefaults() HubConfig {
	if c.QueueSize <= 0 {
		c.QueueSize = defaultHubQueueSize
	}
	if c.SendBufferSize <= 0 {
		c.SendBufferSize = defaultSendBufferSize
	}
	if c.WriteTimeout <= 0 {
		c.WriteTimeout = defaultWriteTimeout
	}
	if c.HeartbeatInterval <= 0 {
		c.HeartbeatInterval = defaultHeartbeatInterval
	}
	if c.IdleTimeout <= 0 {
		c.IdleTimeout = defaultIdleTimeout
	}
	if c.TypingTTL <= 0 {
		c.TypingTTL = defaultTypingTTL
	}
	if c.MaxInboundBytes <= 0 {
		c.MaxInboundBytes = defaultMaxInboundBytes
	}
	return c
}

type pairKey struct {
	a string
	b string
}

func canonicalPair(u1, u2 string) pairKey {
	if u1 < u2 {
		return pairKey{a: u1, b: u2}
	}
	return pairKey{a: u2, b: u1}
}

type typingKey struct {
	convID string
	userID string
}

type typingEntry struct {
	client *Client
	peerID string
	timer  *time.Timer
}

// userLimiter enforces per-user sliding-window limits for WebSocket message.send.
type userLimiter struct {
	mu     sync.Mutex
	window time.Duration
	limit  int
	hits   map[string][]time.Time
}

func newUserLimiter(limit int, window time.Duration) *userLimiter {
	return &userLimiter{
		limit:  limit,
		window: window,
		hits:   make(map[string][]time.Time),
	}
}

func (l *userLimiter) Allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	cutoff := now.Add(-l.window)
	ts := l.hits[userID]
	valid := ts[:0]
	for _, t := range ts {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}
	if len(valid) >= l.limit {
		l.hits[userID] = valid
		return false
	}
	valid = append(valid, now)
	l.hits[userID] = valid
	return true
}

type stagedState uint32

const (
	stagedPending uint32 = iota
	stagedCommitted
	stagedAborted
)

type pairLockEntry struct {
	mu   sync.Mutex
	refs int
}

// StagedEvent represents a slot reserved in Hub's bounded dispatch queue while the
// relay's PostgreSQL transaction is still uncommitted. dispatchLoop cannot observe
// the event until Commit() is called after tx.Commit() succeeds; Abort() discards it.
type StagedEvent struct {
	hub           *Hub
	targetUserIDs []string
	payload       []byte
	userA         string
	userB         string
	pk            pairKey
	stagedEpoch   uint64
	state         atomic.Uint32
}

// Commit releases the staged event to dispatchLoop after the backing DB transaction commits.
// If the hub is already closing or closed, the reserved slot is released and nothing is queued.
func (s *StagedEvent) Commit() {
	if s == nil {
		return
	}
	if !s.state.CompareAndSwap(stagedPending, stagedCommitted) {
		return
	}
	h := s.hub
	h.mu.Lock()
	if h.closed || h.ctx.Err() != nil {
		if h.inFlight > 0 {
			h.inFlight--
		}
		h.releaseStagedPairSlotLocked(s.pk)
		h.mu.Unlock()
		return
	}
	select {
	case h.inbox <- hubQueuedEvent{
		targetUserIDs: s.targetUserIDs,
		payload:       s.payload,
		userA:         s.userA,
		userB:         s.userB,
		pk:            s.pk,
		stagedEpoch:   s.stagedEpoch,
	}:
		h.mu.Unlock()
		return
	default:
		if h.inFlight > 0 {
			h.inFlight--
		}
		h.releaseStagedPairSlotLocked(s.pk)
		h.mu.Unlock()
	}
}

// Abort cancels an uncommitted staged event on transaction rollback or failure,
// freeing its reserved capacity without exposing it to dispatchLoop.
func (s *StagedEvent) Abort() {
	if s == nil {
		return
	}
	if !s.state.CompareAndSwap(stagedPending, stagedAborted) {
		return
	}
	h := s.hub
	h.mu.Lock()
	if h.inFlight > 0 {
		h.inFlight--
	}
	h.releaseStagedPairSlotLocked(s.pk)
	h.mu.Unlock()
}

type hubQueuedEvent struct {
	targetUserIDs []string
	payload       []byte
	userA         string
	userB         string
	pk            pairKey
	stagedEpoch   uint64
}

// Hub manages authenticated WebSocket connections, ephemeral presence, typing indicators,
// slow-client backpressure, and authorized event delivery for a single backend instance.
type Hub struct {
	pool      *pgxpool.Pool
	queries   *dbstore.Queries
	messaging *messaging.Service
	log       *slog.Logger
	cfg       HubConfig

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	inbox chan hubQueuedEvent

	wakeMu sync.RWMutex
	relay  messaging.EventNotifier

	mu                 sync.RWMutex
	closed             bool
	inFlight           int
	conns              map[string]map[*Client]struct{}
	typing             map[typingKey]*typingEntry
	blockedPairs       map[pairKey]struct{}
	pairEpoch          map[pairKey]uint64
	activeStagedByPair map[pairKey]int
	pairLocks          map[pairKey]*pairLockEntry
	sendLimiter        *userLimiter
}

// NewHub initializes a realtime WebSocket Hub and starts its bounded dispatch worker.
func NewHub(pool *pgxpool.Pool, msgSvc *messaging.Service, log *slog.Logger, cfg HubConfig) *Hub {
	if log == nil {
		log = slog.Default()
	}
	cfg = cfg.withDefaults()
	ctx, cancel := context.WithCancel(context.Background())
	h := &Hub{
		pool:               pool,
		queries:            dbstore.New(pool),
		messaging:          msgSvc,
		log:                log,
		cfg:                cfg,
		ctx:                ctx,
		cancel:             cancel,
		inbox:              make(chan hubQueuedEvent, cfg.QueueSize),
		conns:              make(map[string]map[*Client]struct{}),
		typing:             make(map[typingKey]*typingEntry),
		blockedPairs:       make(map[pairKey]struct{}),
		pairEpoch:          make(map[pairKey]uint64),
		activeStagedByPair: make(map[pairKey]int),
		pairLocks:          make(map[pairKey]*pairLockEntry),
		sendLimiter:        newUserLimiter(defaultWSSendLimit, defaultWSSendWindow),
	}
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		h.dispatchLoop()
	}()
	return h
}

// SetRelayNotifier attaches the outbox relay notifier so WS writes trigger immediate relay sweeps.
func (h *Hub) SetRelayNotifier(n messaging.EventNotifier) {
	h.wakeMu.Lock()
	defer h.wakeMu.Unlock()
	h.relay = n
}

func (h *Hub) wakeRelay() {
	h.wakeMu.RLock()
	r := h.relay
	h.wakeMu.RUnlock()
	if r != nil {
		r.WakeRelay()
	}
}

// BeginBlockTransition acquires the per-pair dispatch lock before a block or unblock
// PostgreSQL transaction commits so final check + buffer enqueue in dispatchLoop cannot
// interleave across transaction commit.
func (h *Hub) BeginBlockTransition(userA, userB string) func() {
	if userA == "" || userB == "" {
		return nil
	}
	return h.lockPairDispatch(canonicalPair(userA, userB), true)
}

func (h *Hub) lockPairDispatch(pk pairKey, isBlockAttempt bool) func() {
	h.mu.Lock()
	if h.pairLocks == nil {
		h.pairLocks = make(map[pairKey]*pairLockEntry)
	}
	ent, ok := h.pairLocks[pk]
	if !ok {
		ent = &pairLockEntry{}
		h.pairLocks[pk] = ent
	}
	ent.refs++
	h.mu.Unlock()

	if isBlockAttempt && h.cfg.OnBlockAttemptCommitHook != nil {
		h.cfg.OnBlockAttemptCommitHook(pk.a, pk.b)
	}

	ent.mu.Lock()
	return func() {
		ent.mu.Unlock()
		h.mu.Lock()
		ent.refs--
		if ent.refs == 0 {
			delete(h.pairLocks, pk)
		}
		h.mu.Unlock()
	}
}

func (h *Hub) releaseStagedPairSlotLocked(pk pairKey) {
	if pk.a == "" || pk.b == "" {
		return
	}
	if n := h.activeStagedByPair[pk]; n > 1 {
		h.activeStagedByPair[pk] = n - 1
		return
	}
	delete(h.activeStagedByPair, pk)
	delete(h.pairEpoch, pk)
	if len(h.conns[pk.a]) == 0 && len(h.conns[pk.b]) == 0 {
		delete(h.blockedPairs, pk)
	}
}

func (h *Hub) releaseStagedPairSlot(pk pairKey) {
	h.mu.Lock()
	h.releaseStagedPairSlotLocked(pk)
	h.mu.Unlock()
}

// OnUsersBlocked implements messaging.BlockNotifier to enforce immediate hub-level suppression.
func (h *Hub) OnUsersBlocked(userA, userB string) {
	pk := canonicalPair(userA, userB)
	h.mu.Lock()
	if h.activeStagedByPair[pk] > 0 {
		h.pairEpoch[pk]++
	}
	if len(h.conns[userA]) > 0 || len(h.conns[userB]) > 0 || h.activeStagedByPair[pk] > 0 {
		h.blockedPairs[pk] = struct{}{}
	}
	for k, ent := range h.typing {
		if (k.userID == userA && ent.peerID == userB) || (k.userID == userB && ent.peerID == userA) {
			ent.timer.Stop()
			delete(h.typing, k)
		}
	}
	h.mu.Unlock()
}

// OnUsersUnblocked implements messaging.BlockNotifier when no block remains in either direction.
func (h *Hub) OnUsersUnblocked(userA, userB string) {
	pk := canonicalPair(userA, userB)
	h.mu.Lock()
	delete(h.blockedPairs, pk)
	if h.activeStagedByPair[pk] == 0 {
		delete(h.pairEpoch, pk)
	}
	h.mu.Unlock()
}

func (h *Hub) isPairBlockedMem(userA, userB string) bool {
	if userA == "" || userB == "" {
		return false
	}
	pk := canonicalPair(userA, userB)
	h.mu.RLock()
	_, blocked := h.blockedPairs[pk]
	h.mu.RUnlock()
	return blocked
}

// ActiveConnections returns the total number of active sockets across all users.
func (h *Hub) ActiveConnections() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for _, set := range h.conns {
		total += len(set)
	}
	return total
}

// UserConnectionCount returns how many sockets userID currently has connected.
func (h *Hub) UserConnectionCount(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID])
}

// IsUserOnline reports whether userID has at least one active WebSocket connection.
func (h *Hub) IsUserOnline(userID string) bool {
	return h.UserConnectionCount(userID) > 0
}

// ServeConn registers an accepted WebSocket connection and blocks until it disconnects
// or the Hub shuts down.
func (h *Hub) ServeConn(ctx context.Context, userID string, conn *websocket.Conn) {
	conn.SetReadLimit(h.cfg.MaxInboundBytes)

	client := &Client{
		hub:    h,
		userID: userID,
		conn:   conn,
		send:   make(chan []byte, h.cfg.SendBufferSize),
		done:   make(chan struct{}),
	}
	client.lastReadUnixNano.Store(time.Now().UnixNano())

	// Queue connection.ready BEFORE registering in h.conns so it is guaranteed
	// to be the very first frame transmitted ahead of any outbox/presence events.
	h.sendConnectionReady(ctx, client)

	registered, firstDevice := h.register(client)
	if !registered {
		client.closeWithCode(websocket.StatusGoingAway, "server shutting down")
		return
	}
	defer h.unregister(client)

	// Broadcast online presence only when transitioning 0 -> 1 devices.
	if firstDevice {
		h.broadcastPresence(userID, "online")
	}

	go func() {
		defer h.wg.Done()
		client.writePump(h.ctx)
	}()
	func() {
		defer h.wg.Done()
		client.readPump(h.ctx)
	}()
}

// PendingOutboundCount returns the number of frames currently buffered across userID's active sockets.
func (h *Hub) PendingOutboundCount(userID string) int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for c := range h.conns[userID] {
		if diff := c.enqueuedCount.Load() - c.dequeuedCount.Load(); diff > 0 {
			total += int(diff)
		}
	}
	return total
}

// TotalEnqueuedFrames returns the monotonic count of frames enqueued to userID's currently connected sockets.
func (h *Hub) TotalEnqueuedFrames(userID string) int64 {
	h.mu.RLock()
	defer h.mu.RUnlock()
	var total int64
	for c := range h.conns[userID] {
		total += c.enqueuedCount.Load()
	}
	return total
}

// PairStateCounts returns current map sizes for Hub pair-scoped tracking structures.
func (h *Hub) PairStateCounts() (blockedCount, epochCount, lockCount, activeStagedCount int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.blockedPairs), len(h.pairEpoch), len(h.pairLocks), len(h.activeStagedByPair)
}

// Close gracefully closes all active connections, clears typing timers, and waits for goroutines.
func (h *Hub) Close() {
	h.mu.Lock()
	h.closed = true
	var clients []*Client
	for _, set := range h.conns {
		for c := range set {
			clients = append(clients, c)
		}
	}
	for k, ent := range h.typing {
		ent.timer.Stop()
		delete(h.typing, k)
	}
	h.mu.Unlock()

	h.cancel()

	for _, c := range clients {
		c.closeWithCode(websocket.StatusGoingAway, "server shutting down")
	}
	h.wg.Wait()

	h.mu.Lock()
	clear(h.blockedPairs)
	clear(h.pairEpoch)
	clear(h.activeStagedByPair)
	clear(h.pairLocks)
	h.inFlight = 0
	h.mu.Unlock()
}

// StageConversationEvent reserves capacity in Hub's bounded dispatch queue while the caller
// (OutboxRelay) holds the PostgreSQL pair advisory lock, without exposing the event to
// dispatchLoop until the caller invokes Commit() after PostgreSQL tx.Commit() succeeds.
//
// Catch-up semantics when no eligible targets are connected: returns (nil, nil) immediately so
// the outbox event can be marked published without infinite retry loops; disconnected clients
// recover missed messages authoritatively via REST keyset pagination (GET /messages?after=...).
//
// If any target user has active sockets and the bounded capacity is exhausted, returns
// ErrHubQueueFull so the outbox transaction rolls back and retries cleanly without data loss.
func (h *Hub) StageConversationEvent(targetUserIDs []string, payload []byte, userA, userB string) (*StagedEvent, error) {
	pk := canonicalPair(userA, userB)

	h.mu.Lock()
	if h.closed || h.ctx.Err() != nil {
		h.mu.Unlock()
		return nil, ErrHubClosed
	}
	if _, blocked := h.blockedPairs[pk]; blocked {
		h.mu.Unlock()
		return nil, nil
	}
	hasConnected := false
	for _, uid := range targetUserIDs {
		if len(h.conns[uid]) > 0 {
			hasConnected = true
			break
		}
	}
	if !hasConnected {
		h.mu.Unlock()
		return nil, nil
	}
	if h.inFlight >= h.cfg.QueueSize {
		h.mu.Unlock()
		return nil, ErrHubQueueFull
	}
	h.inFlight++
	if pk.a != "" && pk.b != "" {
		h.activeStagedByPair[pk]++
	}
	epoch := h.pairEpoch[pk]
	h.mu.Unlock()

	targetsCopy := append([]string(nil), targetUserIDs...)
	payloadCopy := append([]byte(nil), payload...)
	return &StagedEvent{
		hub:           h,
		targetUserIDs: targetsCopy,
		payload:       payloadCopy,
		userA:         userA,
		userB:         userB,
		pk:            pk,
		stagedEpoch:   epoch,
	}, nil
}

func (h *Hub) releaseInFlightSlot() {
	h.mu.Lock()
	if h.inFlight > 0 {
		h.inFlight--
	}
	h.mu.Unlock()
}

func (h *Hub) isPairDispatchAllowedLocked(item hubQueuedEvent) bool {
	h.mu.RLock()
	closed := h.closed
	_, blockedMem := h.blockedPairs[item.pk]
	curEpoch := h.pairEpoch[item.pk]
	h.mu.RUnlock()

	return !closed && h.ctx.Err() == nil && !blockedMem && curEpoch == item.stagedEpoch
}

func (h *Hub) dispatchPairEvent(item hubQueuedEvent) {
	defer h.releaseStagedPairSlot(item.pk)

	if h.ctx.Err() != nil {
		return
	}
	// Step 1 (outside per-pair lock): Check authoritative PostgreSQL blocks before acquiring
	// the in-memory pair lock so DB pool waits and pairLocks never form a lock cycle.
	if item.userA != "" && item.userB != "" {
		blockedDB, err := h.queries.CheckIsBlocked(h.ctx, dbstore.CheckIsBlockedParams{
			UserA: item.userA,
			UserB: item.userB,
		})
		if err != nil || blockedDB {
			return
		}
	}

	if h.cfg.BeforeDispatchLockHook != nil {
		h.cfg.BeforeDispatchLockHook(item.userA, item.userB)
	}

	// Step 2 (inside per-pair dispatch lock shared with BlockUser / UnblockUser commits):
	// Perform final unblocked check and non-blocking buffer enqueue atomically w.r.t. block commits.
	if item.pk.a != "" && item.pk.b != "" {
		releasePair := h.lockPairDispatch(item.pk, false)
		defer releasePair()
	}

	if !h.isPairDispatchAllowedLocked(item) {
		return
	}

	if h.cfg.AfterDispatchCheckHook != nil {
		h.cfg.AfterDispatchCheckHook(item.userA, item.userB)
	}

	for _, uid := range item.targetUserIDs {
		h.enqueueToUser(uid, item.payload)
	}
}

func (h *Hub) dispatchLoop() {
	if h.cfg.DispatchGate != nil {
		select {
		case <-h.ctx.Done():
			return
		case <-h.cfg.DispatchGate:
		}
	}

	for {
		select {
		case <-h.ctx.Done():
			return
		case item := <-h.inbox:
			h.releaseInFlightSlot()
			h.dispatchPairEvent(item)
		}
	}
}

func (h *Hub) enqueueToUser(userID string, payload []byte) {
	h.mu.RLock()
	if h.closed || h.ctx.Err() != nil {
		h.mu.RUnlock()
		return
	}
	set := h.conns[userID]
	if len(set) == 0 {
		h.mu.RUnlock()
		return
	}
	targets := make([]*Client, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	h.mu.RUnlock()

	for _, c := range targets {
		c.enqueue(payload)
	}
}

func (h *Hub) register(c *Client) (registered bool, firstDevice bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false, false
	}
	h.wg.Add(2)
	set, ok := h.conns[c.userID]
	if !ok {
		set = make(map[*Client]struct{})
		h.conns[c.userID] = set
	}
	first := len(set) == 0
	set[c] = struct{}{}
	return true, first
}

func (h *Hub) unregister(c *Client) {
	c.closeDone()

	h.mu.Lock()
	set := h.conns[c.userID]
	if set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(h.conns, c.userID)
		}
	}
	lastDevice := len(h.conns[c.userID]) == 0
	if lastDevice {
		for pk := range h.blockedPairs {
			if (pk.a == c.userID || pk.b == c.userID) && h.activeStagedByPair[pk] == 0 && len(h.conns[pk.a]) == 0 && len(h.conns[pk.b]) == 0 {
				delete(h.blockedPairs, pk)
			}
		}
	}

	// Stop any typing indicators owned by this disconnecting device.
	var stopped []typingEntry
	var stoppedConvs []string
	for k, ent := range h.typing {
		if k.userID == c.userID && ent.client == c {
			ent.timer.Stop()
			delete(h.typing, k)
			stopped = append(stopped, *ent)
			stoppedConvs = append(stoppedConvs, k.convID)
		}
	}
	h.mu.Unlock()

	for i, ent := range stopped {
		h.emitTyping(stoppedConvs[i], c.userID, ent.peerID, "typing.stopped")
	}

	if lastDevice {
		h.broadcastPresence(c.userID, "offline")
	}
}

func (h *Hub) sendConnectionReady(ctx context.Context, c *Client) {
	active, err := h.queries.ListActiveConversationIDsForUser(ctx, c.userID)
	if err != nil {
		h.log.ErrorContext(ctx, "list active conversations for connection.ready", "error", err.Error())
		active = []string{}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	env := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "connection.ready",
		"timestamp": now,
		"payload": map[string]interface{}{
			"userId":              c.userID,
			"serverTime":          now,
			"activeConversations": active,
		},
	}
	data, err := json.Marshal(env)
	if err == nil {
		c.enqueue(data)
	}
}

func (h *Hub) broadcastPresence(userID, status string) {
	ctx, cancel := context.WithTimeout(h.ctx, 2*time.Second)
	defer cancel()

	peers, err := h.queries.ListPresencePeersForUser(ctx, userID)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			h.log.ErrorContext(ctx, "list presence peers", "error", err.Error())
		}
		return
	}
	if len(peers) == 0 {
		return
	}

	now := time.Now().UTC().Format(time.RFC3339Nano)
	env := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "presence.updated",
		"timestamp": now,
		"payload": map[string]interface{}{
			"userId":     userID,
			"status":     status,
			"lastSeenAt": now,
		},
	}
	data, err := json.Marshal(env)
	if err != nil {
		return
	}

	for _, peerID := range peers {
		if !h.isPairBlockedMem(userID, peerID) {
			h.enqueueToUser(peerID, data)
		}
	}
}

// ---------- Client Connection Pumps & Inbound Frame Dispatch ----------

// Client represents one authenticated WebSocket connection (one device/tab).
type Client struct {
	hub              *Hub
	userID           string
	conn             *websocket.Conn
	send             chan []byte
	done             chan struct{}
	doneOnce         sync.Once
	closeOnce        sync.Once
	lastReadUnixNano atomic.Int64
	enqueuedCount    atomic.Int64
	dequeuedCount    atomic.Int64
}

func (c *Client) closeDone() {
	c.doneOnce.Do(func() {
		close(c.done)
	})
}

func (c *Client) closeWithCode(code websocket.StatusCode, reason string) {
	c.closeOnce.Do(func() {
		_ = c.conn.Close(code, reason)
	})
}

func (c *Client) closeNow() {
	c.closeOnce.Do(func() {
		_ = c.conn.CloseNow()
	})
}

func (c *Client) enqueue(frame []byte) {
	select {
	case <-c.done:
		return
	default:
	}
	select {
	case c.send <- frame:
		c.enqueuedCount.Add(1)
	case <-c.done:
	default:
		// Outbound buffer saturated (slow client): immediately tear down without blocking hub/relay.
		c.closeDone()
		c.closeNow()
	}
}

func (c *Client) readPump(hubCtx context.Context) {
	defer c.closeWithCode(websocket.StatusNormalClosure, "")

	for {
		_, data, err := c.conn.Read(hubCtx)
		if err != nil {
			return
		}
		c.lastReadUnixNano.Store(time.Now().UnixNano())
		c.hub.handleInbound(hubCtx, c, data)
	}
}

func (c *Client) writePump(hubCtx context.Context) {
	hbInterval := c.hub.cfg.HeartbeatInterval
	idleCheckInterval := hbInterval
	if c.hub.cfg.IdleTimeout < idleCheckInterval {
		idleCheckInterval = c.hub.cfg.IdleTimeout / 2
		if idleCheckInterval < 5*time.Millisecond {
			idleCheckInterval = 5 * time.Millisecond
		}
	}

	ticker := time.NewTicker(idleCheckInterval)
	defer ticker.Stop()

	lastPingSent := time.Now()

	for {
		select {
		case <-hubCtx.Done():
			c.closeWithCode(websocket.StatusGoingAway, "server shutting down")
			return
		case <-c.done:
			return
		case frame := <-c.send:
			c.dequeuedCount.Add(1)
			wctx, cancel := context.WithTimeout(hubCtx, c.hub.cfg.WriteTimeout)
			err := c.conn.Write(wctx, websocket.MessageText, frame)
			cancel()
			if err != nil {
				c.closeWithCode(websocket.StatusGoingAway, "write failed")
				return
			}
		case now := <-ticker.C:
			lastRead := time.Unix(0, c.lastReadUnixNano.Load())
			if now.Sub(lastRead) > c.hub.cfg.IdleTimeout {
				c.closeWithCode(websocket.StatusGoingAway, "idle timeout")
				return
			}
			if now.Sub(lastPingSent) >= hbInterval {
				lastPingSent = now
				pctx, cancel := context.WithTimeout(hubCtx, c.hub.cfg.WriteTimeout)
				err := c.conn.Ping(pctx)
				cancel()
				if err != nil {
					c.closeWithCode(websocket.StatusGoingAway, "heartbeat failed")
					return
				}
			}
		}
	}
}

type inboundFrame struct {
	V       int             `json:"v"`
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func (h *Hub) handleInbound(ctx context.Context, c *Client, raw []byte) {
	var f inboundFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		h.sendErrorFrame(c, "BAD_REQUEST", "Invalid JSON frame.", "")
		return
	}
	if f.V != 1 || f.Type == "" {
		h.sendErrorFrame(c, "BAD_REQUEST", "Unsupported protocol version or missing event type.", "")
		return
	}

	switch f.Type {
	case "ping":
		h.sendPongFrame(c)
	case "message.send":
		h.handleMessageSend(ctx, c, f.Payload)
	case "message.delivered":
		h.handleMessageDelivered(ctx, c, f.Payload)
	case "message.read":
		h.handleMessageRead(ctx, c, f.Payload)
	case "typing.started":
		h.handleTyping(ctx, c, f.Payload, true)
	case "typing.stopped":
		h.handleTyping(ctx, c, f.Payload, false)
	default:
		h.sendErrorFrame(c, "BAD_REQUEST", "Unknown event type.", "")
	}
}

func (h *Hub) sendPongFrame(c *Client) {
	env := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "pong",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   map[string]interface{}{},
	}
	if data, err := json.Marshal(env); err == nil {
		c.enqueue(data)
	}
}

func (h *Hub) sendErrorFrame(c *Client, code, message, clientMessageID string) {
	payload := map[string]interface{}{
		"code":    code,
		"message": message,
	}
	if clientMessageID != "" {
		payload["clientMessageId"] = clientMessageID
	}
	env := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "error",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload":   payload,
	}
	if data, err := json.Marshal(env); err == nil {
		c.enqueue(data)
	}
}

func (h *Hub) handleMessageSend(ctx context.Context, c *Client, raw json.RawMessage) {
	var p struct {
		ConversationID  string `json:"conversationId"`
		ClientMessageID string `json:"clientMessageId"`
		Content         string `json:"content"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		h.sendErrorFrame(c, "BAD_REQUEST", "Invalid message.send payload.", "")
		return
	}
	if !h.sendLimiter.Allow(c.userID) {
		h.sendErrorFrame(c, "RATE_LIMITED", "Too many messages. Slow down.", p.ClientMessageID)
		return
	}

	msg, err := h.messaging.SendMessage(ctx, c.userID, p.ConversationID, p.ClientMessageID, p.Content)
	if err != nil {
		h.mapServiceErrorFrame(c, err, p.ClientMessageID)
		return
	}
	h.wakeRelay()

	ack := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      "message.ack",
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload": map[string]interface{}{
			"clientMessageId": msg.ClientMessageID,
			"messageId":       msg.ID,
			"sequenceNum":     msg.SequenceNum,
			"createdAt":       msg.CreatedAt.UTC().Format(time.RFC3339Nano),
		},
	}
	if data, err := json.Marshal(ack); err == nil {
		c.enqueue(data)
	}
}

func (h *Hub) handleMessageDelivered(ctx context.Context, c *Client, raw json.RawMessage) {
	var p struct {
		ConversationID string `json:"conversationId"`
		MessageID      string `json:"messageId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		h.sendErrorFrame(c, "BAD_REQUEST", "Invalid message.delivered payload.", "")
		return
	}
	if err := h.messaging.MarkDelivered(ctx, c.userID, p.ConversationID, p.MessageID); err != nil {
		h.mapServiceErrorFrame(c, err, "")
		return
	}
	h.wakeRelay()
}

func (h *Hub) handleMessageRead(ctx context.Context, c *Client, raw json.RawMessage) {
	var p struct {
		ConversationID string `json:"conversationId"`
		MessageID      string `json:"messageId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		h.sendErrorFrame(c, "BAD_REQUEST", "Invalid message.read payload.", "")
		return
	}
	if err := h.messaging.MarkRead(ctx, c.userID, p.ConversationID, p.MessageID); err != nil {
		h.mapServiceErrorFrame(c, err, "")
		return
	}
	h.wakeRelay()
}

func (h *Hub) handleTyping(ctx context.Context, c *Client, raw json.RawMessage, started bool) {
	var p struct {
		ConversationID string `json:"conversationId"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || !messaging.IsValidUUID(p.ConversationID) {
		h.sendErrorFrame(c, "BAD_REQUEST", "Invalid typing payload.", "")
		return
	}

	peerID, allowed, err := h.authorizeTyping(ctx, c.userID, p.ConversationID)
	if err != nil {
		h.log.ErrorContext(ctx, "authorize typing", "error", err.Error())
		h.sendErrorFrame(c, "INTERNAL_ERROR", "An internal error occurred.", "")
		return
	}
	if !allowed {
		h.sendErrorFrame(c, "FORBIDDEN", "Typing notifications are not permitted in this conversation.", "")
		return
	}

	tk := typingKey{convID: p.ConversationID, userID: c.userID}
	h.mu.Lock()
	if existing, ok := h.typing[tk]; ok {
		existing.timer.Stop()
		delete(h.typing, tk)
	}
	if started {
		var entry *typingEntry
		timer := time.AfterFunc(h.cfg.TypingTTL, func() {
			h.mu.Lock()
			cur, ok := h.typing[tk]
			if !ok || cur != entry {
				h.mu.Unlock()
				return
			}
			delete(h.typing, tk)
			h.mu.Unlock()
			h.emitTyping(p.ConversationID, c.userID, peerID, "typing.stopped")
		})
		entry = &typingEntry{client: c, peerID: peerID, timer: timer}
		h.typing[tk] = entry
	}
	h.mu.Unlock()

	if started {
		h.emitTyping(p.ConversationID, c.userID, peerID, "typing.started")
	} else {
		h.emitTyping(p.ConversationID, c.userID, peerID, "typing.stopped")
	}
}

func (h *Hub) authorizeTyping(ctx context.Context, userID, convID string) (peerID string, allowed bool, err error) {
	_, err = h.queries.GetConversationMember(ctx, dbstore.GetConversationMemberParams{
		ConversationID: convID,
		UserID:         userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	conv, err := h.queries.GetConversationByID(ctx, convID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if conv.Status != "accepted" {
		return "", false, nil
	}

	blocked, err := h.queries.CheckIsBlocked(ctx, dbstore.CheckIsBlockedParams{
		UserA: conv.UserAID,
		UserB: conv.UserBID,
	})
	if err != nil {
		return "", false, err
	}
	if blocked {
		return "", false, nil
	}

	if conv.UserAID == userID {
		peerID = conv.UserBID
	} else {
		peerID = conv.UserAID
	}
	return peerID, true, nil
}

func (h *Hub) emitTyping(convID, senderID, peerID, eventType string) {
	if h.isPairBlockedMem(senderID, peerID) {
		return
	}
	env := map[string]interface{}{
		"v":         1,
		"id":        messaging.NewUUID(),
		"type":      eventType,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"payload": map[string]interface{}{
			"conversationId": convID,
			"userId":         senderID,
		},
	}
	if data, err := json.Marshal(env); err == nil {
		h.enqueueToUser(peerID, data)
	}
}

func (h *Hub) mapServiceErrorFrame(c *Client, err error, clientMessageID string) {
	var ve *messaging.ValidationError
	switch {
	case errors.As(err, &ve):
		h.sendErrorFrame(c, "BAD_REQUEST", ve.Error(), clientMessageID)
	case errors.Is(err, messaging.ErrBlocked):
		h.sendErrorFrame(c, "BLOCKED", "You cannot message this user.", clientMessageID)
	case errors.Is(err, messaging.ErrForbidden),
		errors.Is(err, messaging.ErrPendingLimit),
		errors.Is(err, messaging.ErrPendingRecipient),
		errors.Is(err, messaging.ErrDeclined),
		errors.Is(err, messaging.ErrNotFound):
		h.sendErrorFrame(c, "FORBIDDEN", err.Error(), clientMessageID)
	case errors.Is(err, messaging.ErrInvalidCursor),
		errors.Is(err, messaging.ErrMessageNotFound):
		h.sendErrorFrame(c, "BAD_REQUEST", err.Error(), clientMessageID)
	default:
		h.log.Error("websocket service error", "error", err.Error())
		h.sendErrorFrame(c, "INTERNAL_ERROR", "An internal error occurred.", clientMessageID)
	}
}
