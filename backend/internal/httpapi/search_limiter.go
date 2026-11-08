package httpapi

import (
	"sync"
	"time"
)

// SlidingLimiter enforces an atomic sliding-window rate limit keyed by session ID.
type SlidingLimiter struct {
	mu     sync.Mutex
	limits map[string][]time.Time
	limit  int
	window time.Duration
}

// SearchLimiter is an alias for SlidingLimiter for search-specific backward compatibility.
type SearchLimiter = SlidingLimiter

// NewSlidingLimiter creates a new sliding window limiter.
func NewSlidingLimiter(limit int, window time.Duration) *SlidingLimiter {
	return &SlidingLimiter{
		limits: make(map[string][]time.Time),
		limit:  limit,
		window: window,
	}
}

// NewSearchLimiter creates a new sliding window limiter.
func NewSearchLimiter(limit int, window time.Duration) *SearchLimiter {
	return NewSlidingLimiter(limit, window)
}

// Allow reports whether a request for sessionID is allowed under the rate limit.
// If allowed, it records the request and returns (true, 0).
// If rate limited, it returns (false, retryAfter).
func (sl *SlidingLimiter) Allow(sessionID string) (bool, time.Duration) {
	sl.mu.Lock()
	defer sl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-sl.window)

	// Filter timestamps within current window
	times := sl.limits[sessionID]
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= sl.limit {
		sl.limits[sessionID] = valid
		oldest := valid[0]
		retryAfter := oldest.Add(sl.window).Sub(now)
		if retryAfter < time.Second {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	valid = append(valid, now)
	sl.limits[sessionID] = valid

	// Opportunistic garbage collection of stale sessions if map grows
	if len(sl.limits) > 1000 {
		for id, ts := range sl.limits {
			if len(ts) == 0 || ts[len(ts)-1].Before(cutoff) {
				delete(sl.limits, id)
			}
		}
	}

	return true, 0
}
