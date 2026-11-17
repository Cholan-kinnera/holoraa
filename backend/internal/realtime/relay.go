package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Cholan-kinnera/holoraa/backend/internal/messaging"
	"github.com/Cholan-kinnera/holoraa/backend/internal/store/dbstore"
)

const (
	defaultRelayBatchSize       int32 = 50
	defaultRelayPollInterval          = 150 * time.Millisecond
	defaultTicketCleanupIntvl         = 60 * time.Second
	defaultRelayMaxAttempts     int16 = 5
	defaultRelayBaseBackoff           = 100 * time.Millisecond
	defaultRelayMaxBackoff            = 10 * time.Second
	suppressedBlockReason             = "suppressed: relationship blocked"
	suppressedMissingConvReason       = "suppressed: conversation not found"
)

// ErrLeaseLost indicates a worker failed claim-token / lease-expiration fencing.
var ErrLeaseLost = errors.New("outbox lease lost or expired")

// RelayConfig configures outbox relay polling, batching, retries, and poison handling.
type RelayConfig struct {
	WorkerID              string
	BatchSize             int32
	PollInterval          time.Duration
	TicketCleanupInterval time.Duration
	MaxAttempts           int16
	BaseBackoff           time.Duration
	MaxBackoff            time.Duration
	// Optional deterministic fault-injection / concurrency test hooks (nil in production).
	AfterEnqueueHook func(ctx context.Context, ev dbstore.ClaimOutboxBatchWithLeaseRow) error
	BeforeCommitHook func(ctx context.Context, ev dbstore.ClaimOutboxBatchWithLeaseRow) error
}

func (c RelayConfig) withDefaults() RelayConfig {
	if c.WorkerID == "" {
		c.WorkerID = "relay-" + messaging.NewUUID()[:8]
	}
	if c.BatchSize <= 0 {
		c.BatchSize = defaultRelayBatchSize
	}
	if c.PollInterval <= 0 {
		c.PollInterval = defaultRelayPollInterval
	}
	if c.TicketCleanupInterval <= 0 {
		c.TicketCleanupInterval = defaultTicketCleanupIntvl
	}
	if c.MaxAttempts <= 0 {
		c.MaxAttempts = defaultRelayMaxAttempts
	}
	if c.BaseBackoff <= 0 {
		c.BaseBackoff = defaultRelayBaseBackoff
	}
	if c.MaxBackoff <= 0 {
		c.MaxBackoff = defaultRelayMaxBackoff
	}
	return c
}

// OutboxRelay claims persisted outbox events with SKIP LOCKED leases, enforces
// pair-locked block authorization/suppression, and fans out authorized frames to Hub.
type OutboxRelay struct {
	pool    *pgxpool.Pool
	queries *dbstore.Queries
	hub     *Hub
	tickets *TicketService
	log     *slog.Logger
	cfg     RelayConfig
	wakeCh  chan struct{}
}

// NewOutboxRelay initializes an OutboxRelay worker.
func NewOutboxRelay(pool *pgxpool.Pool, hub *Hub, tickets *TicketService, log *slog.Logger, cfg RelayConfig) *OutboxRelay {
	if log == nil {
		log = slog.Default()
	}
	return &OutboxRelay{
		pool:    pool,
		queries: dbstore.New(pool),
		hub:     hub,
		tickets: tickets,
		log:     log,
		cfg:     cfg.withDefaults(),
		wakeCh:  make(chan struct{}, 1),
	}
}

// WakeRelay triggers an immediate non-blocking relay sweep after an outbox commit.
func (r *OutboxRelay) WakeRelay() {
	select {
	case r.wakeCh <- struct{}{}:
	default:
	}
}

// Run polls and drains outbox events until ctx is cancelled.
func (r *OutboxRelay) Run(ctx context.Context) {
	pollTicker := time.NewTicker(r.cfg.PollInterval)
	defer pollTicker.Stop()

	cleanupTicker := time.NewTicker(r.cfg.TicketCleanupInterval)
	defer cleanupTicker.Stop()

	// Drain any events persisted before process startup (crash recovery).
	if _, err := r.ProcessOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
		r.log.ErrorContext(ctx, "initial outbox drain failed", "worker_id", r.cfg.WorkerID, "error", err.Error())
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-r.wakeCh:
			if _, err := r.ProcessOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				r.log.ErrorContext(ctx, "outbox wake sweep failed", "worker_id", r.cfg.WorkerID, "error", err.Error())
			}
		case <-pollTicker.C:
			if _, err := r.ProcessOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				r.log.ErrorContext(ctx, "outbox poll sweep failed", "worker_id", r.cfg.WorkerID, "error", err.Error())
			}
		case <-cleanupTicker.C:
			if r.tickets != nil {
				if _, err := r.tickets.CleanupExpired(ctx); err != nil && !errors.Is(err, context.Canceled) {
					r.log.WarnContext(ctx, "cleanup expired ws tickets", "error", err.Error())
				}
			}
		}
	}
}

// ClaimBatch claims up to BatchSize claimable outbox rows under SKIP LOCKED.
func (r *OutboxRelay) ClaimBatch(ctx context.Context) ([]dbstore.ClaimOutboxBatchWithLeaseRow, error) {
	return r.queries.ClaimOutboxBatchWithLease(ctx, dbstore.ClaimOutboxBatchWithLeaseParams{
		BatchSize: r.cfg.BatchSize,
		WorkerID:  r.cfg.WorkerID,
	})
}

// ProcessOnce drains all currently claimable outbox batches.
func (r *OutboxRelay) ProcessOnce(ctx context.Context) (int, error) {
	total := 0
	for {
		if ctx.Err() != nil {
			return total, ctx.Err()
		}
		batch, err := r.ClaimBatch(ctx)
		if err != nil {
			return total, fmt.Errorf("claim outbox batch: %w", err)
		}
		if len(batch) == 0 {
			return total, nil
		}
		for _, ev := range batch {
			if ctx.Err() != nil {
				return total, ctx.Err()
			}
			if err := r.ProcessClaimedEvent(ctx, ev); err != nil {
				if errors.Is(err, ErrLeaseLost) {
					r.log.WarnContext(ctx, "stale worker lost outbox lease", "worker_id", r.cfg.WorkerID, "event_id", ev.ID, "event_type", ev.EventType)
					continue
				}
				r.handleFailure(ctx, ev, err)
				continue
			}
			total++
		}
		if int32(len(batch)) < r.cfg.BatchSize {
			return total, nil
		}
	}
}

// ProcessClaimedEvent authorizes a single claimed outbox event against PostgreSQL
// using the pair advisory lock (zero network I/O inside DB tx) and fans out via Hub.
func (r *OutboxRelay) ProcessClaimedEvent(ctx context.Context, ev dbstore.ClaimOutboxBatchWithLeaseRow) error {
	if ev.ClaimToken == nil {
		return errors.New("missing claim token")
	}
	if err := validateOutboxEnvelope(ev.Payload); err != nil {
		// Unrecoverable malformed payload: fence-mark poison immediately if lease valid.
		rows, pErr := r.queries.MarkOutboxPoison(ctx, dbstore.MarkOutboxPoisonParams{
			ErrorMessage: "malformed payload: " + err.Error(),
			ID:           ev.ID,
			WorkerID:     r.cfg.WorkerID,
			ClaimToken:   *ev.ClaimToken,
		})
		if pErr != nil {
			return fmt.Errorf("mark malformed event poison: %w", pErr)
		}
		if rows == 0 {
			return ErrLeaseLost
		}
		r.log.ErrorContext(ctx, "outbox event quarantined as poison", "worker_id", r.cfg.WorkerID, "event_id", ev.ID, "event_type", ev.EventType, "attempts", ev.Attempts, "reason", "malformed_payload")
		return nil
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return fmt.Errorf("begin authorize tx: %w", err)
	}
	defer tx.Rollback(ctx)
	qtx := r.queries.WithTx(tx)

	conv, err := qtx.GetConversationByID(ctx, ev.ConversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		rows, sErr := qtx.MarkOutboxSuppressed(ctx, dbstore.MarkOutboxSuppressedParams{
			ErrorMessage: suppressedMissingConvReason,
			ID:           ev.ID,
			WorkerID:     r.cfg.WorkerID,
			ClaimToken:   *ev.ClaimToken,
		})
		if sErr != nil {
			return fmt.Errorf("suppress missing conversation event: %w", sErr)
		}
		if rows == 0 {
			return ErrLeaseLost
		}
		return tx.Commit(ctx)
	}
	if err != nil {
		return fmt.Errorf("lookup conversation: %w", err)
	}

	// Coordinate deterministically with BlockUser / UnblockUser via pair advisory lock.
	if err := qtx.AcquirePairAdvisoryLock(ctx, dbstore.AcquirePairAdvisoryLockParams{
		UserA: conv.UserAID,
		UserB: conv.UserBID,
	}); err != nil {
		return fmt.Errorf("acquire pair advisory lock: %w", err)
	}

	blocked, err := qtx.CheckIsBlocked(ctx, dbstore.CheckIsBlockedParams{
		UserA: conv.UserAID,
		UserB: conv.UserBID,
	})
	if err != nil {
		return fmt.Errorf("check block status: %w", err)
	}

	if blocked {
		rows, sErr := qtx.MarkOutboxSuppressed(ctx, dbstore.MarkOutboxSuppressedParams{
			ErrorMessage: suppressedBlockReason,
			ID:           ev.ID,
			WorkerID:     r.cfg.WorkerID,
			ClaimToken:   *ev.ClaimToken,
		})
		if sErr != nil {
			return fmt.Errorf("mark outbox suppressed: %w", sErr)
		}
		if rows == 0 {
			return ErrLeaseLost
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit suppressed event: %w", err)
		}
		r.log.InfoContext(ctx, "outbox event terminally suppressed due to block", "worker_id", r.cfg.WorkerID, "event_id", ev.ID, "event_type", ev.EventType)
		return nil
	}

	// Verify lease & fencing token before hub enqueue so stale workers cannot emit frames.
	leaseValid, err := qtx.IsOutboxLeaseValid(ctx, dbstore.IsOutboxLeaseValidParams{
		ID:         ev.ID,
		WorkerID:   r.cfg.WorkerID,
		ClaimToken: *ev.ClaimToken,
	})
	if err != nil {
		return fmt.Errorf("check outbox lease: %w", err)
	}
	if !leaseValid {
		return ErrLeaseLost
	}

	// Step 6: Synchronous, non-blocking, bounded staging in Hub while holding the pair lock.
	// The staged event stays invisible to dispatchLoop until Step 8 commits PostgreSQL tx
	// and calls staged.Commit(). Any error or rollback runs staged.Abort() via defer.
	var staged *StagedEvent
	if r.hub != nil {
		staged, err = r.hub.StageConversationEvent(ev.TargetUserIds, ev.Payload, conv.UserAID, conv.UserBID)
		if err != nil {
			return err
		}
		defer staged.Abort()
	}
	if r.cfg.AfterEnqueueHook != nil {
		if err := r.cfg.AfterEnqueueHook(ctx, ev); err != nil {
			return err
		}
	}

	// Step 7: Mark outbox event published only after hub acceptance (claim-token & lease fenced).
	rows, err := qtx.MarkOutboxPublished(ctx, dbstore.MarkOutboxPublishedParams{
		ID:         ev.ID,
		WorkerID:   r.cfg.WorkerID,
		ClaimToken: *ev.ClaimToken,
	})
	if err != nil {
		return fmt.Errorf("mark outbox published: %w", err)
	}
	if rows == 0 {
		return ErrLeaseLost
	}

	if r.cfg.BeforeCommitHook != nil {
		if err := r.cfg.BeforeCommitHook(ctx, ev); err != nil {
			return err
		}
	}

	// Step 8: Commit the transaction (releasing the pair advisory lock), then release dispatch.
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit published event: %w", err)
	}
	staged.Commit()
	return nil
}

func (r *OutboxRelay) handleFailure(ctx context.Context, ev dbstore.ClaimOutboxBatchWithLeaseRow, procErr error) {
	if ev.ClaimToken == nil {
		return
	}
	if ev.Attempts >= r.cfg.MaxAttempts {
		rows, err := r.queries.MarkOutboxPoison(ctx, dbstore.MarkOutboxPoisonParams{
			ErrorMessage: procErr.Error(),
			ID:           ev.ID,
			WorkerID:     r.cfg.WorkerID,
			ClaimToken:   *ev.ClaimToken,
		})
		if err != nil {
			r.log.ErrorContext(ctx, "failed to quarantine outbox poison event", "worker_id", r.cfg.WorkerID, "event_id", ev.ID, "error", err.Error())
			return
		}
		if rows == 0 {
			r.log.WarnContext(ctx, "stale worker failed to mark poison after lease expiry", "worker_id", r.cfg.WorkerID, "event_id", ev.ID)
			return
		}
		r.log.ErrorContext(ctx, "outbox event transitioned to poison after max attempts",
			"worker_id", r.cfg.WorkerID, "event_id", ev.ID, "event_type", ev.EventType, "attempts", ev.Attempts, "error", procErr.Error())
		return
	}

	backoff := r.computeBackoff(ev.Attempts)
	nextRetry := time.Now().UTC().Add(backoff)
	rows, err := r.queries.ScheduleOutboxRetry(ctx, dbstore.ScheduleOutboxRetryParams{
		ErrorMessage: procErr.Error(),
		NextRetryAt:  pgtype.Timestamptz{Time: nextRetry, Valid: true},
		ID:           ev.ID,
		WorkerID:     r.cfg.WorkerID,
		ClaimToken:   *ev.ClaimToken,
	})
	if err != nil {
		r.log.ErrorContext(ctx, "failed to schedule outbox retry", "worker_id", r.cfg.WorkerID, "event_id", ev.ID, "error", err.Error())
		return
	}
	if rows == 0 {
		r.log.WarnContext(ctx, "stale worker failed to schedule retry after lease expiry", "worker_id", r.cfg.WorkerID, "event_id", ev.ID)
		return
	}
	r.log.WarnContext(ctx, "outbox event scheduled for backoff retry",
		"worker_id", r.cfg.WorkerID, "event_id", ev.ID, "event_type", ev.EventType, "attempts", ev.Attempts, "retry_in_ms", backoff.Milliseconds())
}

func (r *OutboxRelay) computeBackoff(attempts int16) time.Duration {
	shift := attempts - 1
	if shift < 0 {
		shift = 0
	}
	if shift > 10 {
		shift = 10
	}
	d := r.cfg.BaseBackoff << shift
	if d > r.cfg.MaxBackoff || d <= 0 {
		d = r.cfg.MaxBackoff
	}
	return d
}

func validateOutboxEnvelope(raw []byte) error {
	var env struct {
		V    int    `json:"v"`
		ID   string `json:"id"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return errors.New("invalid json")
	}
	if env.V != 1 || env.ID == "" || env.Type == "" {
		return errors.New("missing required envelope fields")
	}
	return nil
}
