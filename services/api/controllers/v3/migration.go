package v3

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"mime"
	"net/http"
	"thread_api/service/vault"
	"time"
)

type MigrationStore interface {
	MigrationPush(context.Context, string, []byte) (vault.PushResult, error)
	MigrationSnapshot(context.Context, string, []byte) (vault.Snapshot, error)
	MigrationSnapshotPage(context.Context, string, []byte) (vault.SnapshotPage, error)
	VerifyMigration(context.Context, string, []byte) (vault.MigrationStatus, error)
	CommitMigration(context.Context, string, []byte) (vault.MigrationStatus, error)
	PrepareMigration(context.Context, string, []byte) (vault.MigrationStatus, error)
	MigrationStatus(context.Context, string, []byte) (vault.MigrationStatus, error)
	MigrationSource(context.Context, string, []byte) (vault.MigrationSourcePage, error)
	CancelMigration(context.Context, string, []byte) (vault.MigrationStatus, error)
}

func RegisterMigration(r *gin.Engine, s MigrationStore, secret []byte) {
	g := r.Group("/v3/migration", UserPrincipal(secret))
	handle := func(run func(context.Context, string, []byte) (interface{}, error)) gin.HandlerFunc {
		return func(c *gin.Context) {
			media, _, e := mime.ParseMediaType(c.GetHeader("Content-Type"))
			if e != nil || media != "application/cbor" {
				c.AbortWithStatusJSON(415, gin.H{"code": "CBOR_REQUIRED"})
				return
			}
			raw, e := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, vault.MaxBytes))
			if e != nil {
				c.AbortWithStatusJSON(413, gin.H{"code": "REQUEST_TOO_LARGE"})
				return
			}
			ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
			defer cancel()
			result, e := run(ctx, c.GetString("uid"), raw)
			if e == nil {
				c.JSON(200, result)
				return
			}
			status, code := 500, "MIGRATION_UNAVAILABLE"
			switch {
			case errors.Is(e, vault.ErrObjectConflict):
				status, code = 409, "OBJECT_CONFLICT"
			case errors.Is(e, vault.ErrInactive):
				status, code = 409, "E2EE_NOT_ACTIVE"
			case errors.Is(e, vault.ErrQuota):
				status, code = 429, "SNAPSHOT_LIMIT"
			case errors.Is(e, vault.ErrInvalid):
				status, code = 400, "INVALID_SIGNED_RECORD"
			case errors.Is(e, vault.ErrForbidden):
				status, code = 403, "DEVICE_FORBIDDEN"
			case errors.Is(e, vault.ErrNotFound):
				status, code = 404, "MIGRATION_NOT_FOUND"
			case errors.Is(e, vault.ErrConflict):
				status, code = 409, "MIGRATION_CONFLICT"
			case errors.Is(e, vault.ErrMigrationSourceLimit):
				status, code = 413, "MIGRATION_SOURCE_LIMIT"
			}
			c.JSON(status, gin.H{"code": code})
		}
	}
	g.POST("/prepare", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.PrepareMigration(ctx, u, b)
	}))
	g.POST("/push", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) { return s.MigrationPush(ctx, u, b) }))
	g.POST("/snapshot", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.MigrationSnapshot(ctx, u, b)
	}))
	g.POST("/snapshot/page", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.MigrationSnapshotPage(ctx, u, b)
	}))
	g.POST("/verify", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.VerifyMigration(ctx, u, b)
	}))
	g.POST("/commit", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.CommitMigration(ctx, u, b)
	}))
	g.POST("/status", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.MigrationStatus(ctx, u, b)
	}))
	g.POST("/source", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.MigrationSource(ctx, u, b)
	}))
	g.POST("/cancel", handle(func(ctx context.Context, u string, b []byte) (interface{}, error) {
		return s.CancelMigration(ctx, u, b)
	}))
}
