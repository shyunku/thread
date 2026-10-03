package v3

import (
	"net/http"
	"thread_api/service/syncevents"
	"time"

	"github.com/gin-gonic/gin"
)

var (
	// Keep the stream alive through proxies (Cloudflare drops idle connections at 100 s).
	eventsHeartbeat = 25 * time.Second
	// Streams end periodically so the session check in UserPrincipal runs again on reconnect.
	eventsLifetime = 5 * time.Minute
)

// RegisterSyncEvents streams "changed" signals to the account's devices
// (Server-Sent Events). It is only a hint to pull; it never carries data.
func RegisterSyncEvents(r *gin.Engine, broker *syncevents.Broker, secret []byte) {
	r.GET("/v3/sync/events", UserPrincipal(secret), func(c *gin.Context) {
		signals, cancel := broker.Subscribe(c.GetString("uid"))
		defer cancel()
		w := c.Writer
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		// Tell the client to pull once now: it may have missed changes while disconnected.
		_, _ = w.WriteString("event: changed\ndata: {}\n\n")
		w.Flush()

		heartbeat := time.NewTicker(eventsHeartbeat)
		defer heartbeat.Stop()
		lifetime := time.NewTimer(eventsLifetime)
		defer lifetime.Stop()
		for {
			select {
			case <-c.Request.Context().Done():
				return
			case <-lifetime.C:
				return
			case <-heartbeat.C:
				if _, err := w.WriteString(": ping\n\n"); err != nil {
					return
				}
			case <-signals:
				if _, err := w.WriteString("event: changed\ndata: {}\n\n"); err != nil {
					return
				}
			}
			w.Flush()
		}
	})
}
