package httpapi

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSearchLimiterAllowsUpToLimit(t *testing.T) {
	limiter := NewSearchLimiter(3, time.Minute)
	sessID := "session-alpha"

	for i := 0; i < 3; i++ {
		allowed, retryAfter := limiter.Allow(sessID)
		if !allowed || retryAfter != 0 {
			t.Fatalf("request %d should be allowed, got allowed=%v, retryAfter=%v", i+1, allowed, retryAfter)
		}
	}

	// 4th request exceeds limit
	allowed, retryAfter := limiter.Allow(sessID)
	if allowed {
		t.Fatal("4th request should be rejected")
	}
	if retryAfter <= 0 {
		t.Fatalf("retryAfter should be positive, got %v", retryAfter)
	}
}

func TestSearchLimiterIsolatesDifferentSessions(t *testing.T) {
	limiter := NewSearchLimiter(2, time.Minute)
	sess1 := "session-1"
	sess2 := "session-2"

	// Exhaust sess1
	limiter.Allow(sess1)
	limiter.Allow(sess1)
	if allowed, _ := limiter.Allow(sess1); allowed {
		t.Fatal("sess1 should be rate limited")
	}

	// sess2 must not be affected
	if allowed, _ := limiter.Allow(sess2); !allowed {
		t.Fatal("sess2 should still be allowed")
	}
}

func TestSearchLimiterWindowExpiry(t *testing.T) {
	window := 50 * time.Millisecond
	limiter := NewSearchLimiter(2, window)
	sess := "session-expiry"

	limiter.Allow(sess)
	limiter.Allow(sess)
	if allowed, _ := limiter.Allow(sess); allowed {
		t.Fatal("should be rate limited")
	}

	time.Sleep(window + 10*time.Millisecond)

	if allowed, _ := limiter.Allow(sess); !allowed {
		t.Fatal("request should be allowed after window passes")
	}
}

func TestSearchLimiterConcurrentAccessIsAtomic(t *testing.T) {
	const limit = 10
	const concurrency = 30
	limiter := NewSearchLimiter(limit, time.Minute)
	sess := "session-concurrent"

	var wg sync.WaitGroup
	start := make(chan struct{})
	var allowedCount atomic.Int32
	var rejectedCount atomic.Int32

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			allowed, _ := limiter.Allow(sess)
			if allowed {
				allowedCount.Add(1)
			} else {
				rejectedCount.Add(1)
			}
		}()
	}

	close(start)
	wg.Wait()

	if allowedCount.Load() != limit {
		t.Fatalf("expected exactly %d allowed, got %d", limit, allowedCount.Load())
	}
	if rejectedCount.Load() != concurrency-limit {
		t.Fatalf("expected exactly %d rejected, got %d", concurrency-limit, rejectedCount.Load())
	}
}
