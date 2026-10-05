package v3

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"thread_api/service/database"
	"thread_api/service/pairing"
	"thread_api/service/syncevents"
	"thread_api/service/vault"
	"time"

	"github.com/gin-gonic/gin"
)

type EncryptedSyncStore interface {
	Push(context.Context, string, []byte) (vault.PushResult, error)
	SignedPull(context.Context, string, []byte) (vault.Changes, error)
	SignedSnapshot(context.Context, string, []byte) (vault.Snapshot, error)
	SignedSnapshotPage(context.Context, string, []byte) (vault.SnapshotPage, error)
	SignedStateDigest(context.Context, string, []byte) (vault.StateDigest, error)
	SignedEnvelope(context.Context, string, []byte) (vault.Envelope, error)
}

// Registering APIs never activates or migrates an account.
func UseRouter(r *gin.Engine) {
	if database.DB == nil {
		return
	}
	s := &vault.Store{DB: database.DB.DB}
	secret := []byte(os.Getenv("JWT_ACCESS_SECRET"))
	RegisterPending(r, s, secret)
	syncBroker = syncevents.NewBroker()
	RegisterSync(r, s, secret)
	RegisterSyncEvents(r, syncBroker, secret)
	if pairingStore != nil {
		RegisterPairing(r, pairingStore, secret)
	}
}

var pairingStore pairing.Store

// syncBroker signals an account's other devices after a successful push (nil in tests).
var syncBroker *syncevents.Broker

// SetPairingStore enables the device-connection relay routes.
func SetPairingStore(store pairing.Store) { pairingStore = store }

func RegisterSync(r *gin.Engine, s EncryptedSyncStore, secret []byte) {
	g := r.Group("/v3/sync", UserPrincipal(secret))
	g.Use(func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})
	handle := func(run func(context.Context, string, []byte) (interface{}, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
			if err != nil || media != "application/cbor" {
				c.AbortWithStatusJSON(415, gin.H{"code": "CBOR_REQUIRED"})
				return
			}
			raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, vault.MaxBytes))
			if err != nil {
				c.AbortWithStatusJSON(413, gin.H{"code": "REQUEST_TOO_LARGE"})
				return
			}
			result, err := run(c.Request.Context(), c.GetString("uid"), raw)
			if err == nil {
				c.JSON(200, result)
				return
			}
			status, code := 500, "SYNC_UNAVAILABLE"
			switch {
			case errors.Is(err, vault.ErrInvalid):
				status, code = 400, "INVALID_SIGNED_RECORD"
			case errors.Is(err, vault.ErrForbidden):
				status, code = 403, "DEVICE_FORBIDDEN"
			case errors.Is(err, vault.ErrNotFound):
				status, code = 404, "NOT_FOUND"
			case errors.Is(err, vault.ErrConflict):
				status, code = 409, "SYNC_CHECKPOINT_CONFLICT"
			case errors.Is(err, vault.ErrObjectConflict):
				status, code = 409, "OBJECT_CONFLICT"
			case errors.Is(err, vault.ErrInactive):
				status, code = 409, "E2EE_NOT_ACTIVE"
			case errors.Is(err, vault.ErrQuota):
				status, code = 429, "SNAPSHOT_LIMIT"
			}
			c.JSON(status, gin.H{"code": code})
		}
	}
	g.POST("/push", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) {
		result, err := s.Push(ctx, uid, b)
		if err == nil && syncBroker != nil {
			syncBroker.Notify(uid)
		}
		return result, err
	}))
	g.POST("/envelope", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) {
		return s.SignedEnvelope(ctx, uid, b)
	}))
	g.POST("/pull", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) { return s.SignedPull(ctx, uid, b) }))
	g.POST("/snapshot", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) {
		return s.SignedSnapshot(ctx, uid, b)
	}))
	g.POST("/snapshot/page", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) {
		return s.SignedSnapshotPage(ctx, uid, b)
	}))
	g.POST("/digest", handle(func(ctx context.Context, uid string, b []byte) (interface{}, error) {
		return s.SignedStateDigest(ctx, uid, b)
	}))
}
