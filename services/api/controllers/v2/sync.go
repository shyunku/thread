package v2

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"github.com/gorilla/websocket"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"thread_api/service/canonical"
	"thread_api/service/database"
	"thread_api/service/releasealerts"
	"time"
)

func UseRouter(r *gin.Engine) {
	if database.DB == nil {
		return
	}
	secret := []byte(os.Getenv("JWT_ACCESS_SECRET"))
	key := sha256.Sum256(append([]byte("thread-sync-cursor-v2:"), secret...))
	p := &canonical.Protocol{Store: &canonical.Store{DB: database.DB.DB}, Key: key[:], Enabled: os.Getenv("SYNC_V2_ENABLED") == "true", PruneEnabled: os.Getenv("SYNC_LOG_PRUNE_ENABLED") == "true"}
	Register(r, p, secret)
}
func Register(r *gin.Engine, p *canonical.Protocol, secret []byte) {
	g := r.Group("/v2/sync")
	g.Use(auth(secret))
	g.Use(func(c *gin.Context) { c.Header("Cache-Control", "no-store"); c.Next() })
	g.GET("/capabilities", func(c *gin.Context) {
		a, e := p.Account(c.Request.Context(), c.GetString("uid"))
		if e != nil {
			respondError(c, e)
			return
		}
		if a.Mode != "v2" {
			c.JSON(503, gin.H{"code": "ACCOUNT_MIGRATION_REQUIRED"})
			return
		}
		c.JSON(200, gin.H{"protocolVersion": 2, "mode": a.Mode, "epoch": a.Epoch, "enabled": p.Enabled, "highWatermark": a.Last,
			"operations": []string{"create", "patch", "delete", "move", "completeRecurringTask", "add", "remove"}})
	})
	g.Use(func(c *gin.Context) {
		if !p.Enabled {
			c.AbortWithStatusJSON(503, gin.H{"code": "SYNC_DISABLED"})
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	})
	g.POST("/devices", func(c *gin.Context) {
		var b struct {
			Epoch    string `json:"epoch"`
			DeviceID string `json:"deviceId"`
		}
		if !body(c, &b) {
			return
		}
		if e := p.RegisterDevice(c.Request.Context(), c.GetString("uid"), b.Epoch, b.DeviceID); e != nil {
			respondError(c, e)
			return
		}
		c.JSON(200, gin.H{"deviceId": b.DeviceID})
	})
	g.POST("/push", func(c *gin.Context) {
		var b struct {
			ProtocolVersion int                  `json:"protocolVersion"`
			Epoch           string               `json:"epoch"`
			DeviceID        string               `json:"deviceId"`
			Mutations       []canonical.Mutation `json:"mutations"`
		}
		if !body(c, &b) {
			return
		}
		if b.ProtocolVersion != 2 || len(b.Mutations) < 1 || len(b.Mutations) > 100 {
			c.JSON(400, gin.H{"code": "INVALID_BATCH"})
			return
		}
		results := make([]canonical.Result, len(b.Mutations))
		stopped := false
		for i, m := range b.Mutations {
			if stopped {
				results[i] = canonical.Result{Status: "not_attempted"}
				continue
			}
			if (m.Epoch != "" && m.Epoch != b.Epoch) || (m.DeviceID != "" && m.DeviceID != b.DeviceID) {
				results[i] = canonical.Result{Status: "rejected", Code: "INVALID_BATCH_IDENTITY"}
				stopped = true
				continue
			}
			m.Epoch = b.Epoch
			m.DeviceID = b.DeviceID
			result, e := p.Store.Apply(c.Request.Context(), c.GetString("uid"), m)
			if e != nil {
				// Prior results may already be committed. Every retry must retain its ID.
				result = canonical.Result{Status: "retry", Code: canonical.ErrorCode(e)}
				stopped = true
			} else if result.Status != "accepted" {
				stopped = true
			}
			results[i] = result
		}
		c.JSON(200, gin.H{"results": results})
	})
	g.GET("/changes", func(c *gin.Context) {
		limit := 500
		if raw := c.Query("limit"); raw != "" {
			var e error
			limit, e = strconv.Atoi(raw)
			if e != nil {
				c.JSON(400, gin.H{"code": "INVALID_LIMIT"})
				return
			}
		}
		page, e := p.Pull(c.Request.Context(), c.GetString("uid"), c.Query("epoch"), c.Query("after"), c.Query("until"), limit)
		if e != nil {
			respondError(c, e)
			return
		}
		c.JSON(200, page)
	})
	g.POST("/snapshots", func(c *gin.Context) {
		var b struct {
			Epoch string `json:"epoch"`
		}
		if !body(c, &b) {
			return
		}
		s, e := p.Snapshot(c.Request.Context(), c.GetString("uid"), b.Epoch)
		if e != nil {
			respondError(c, e)
			return
		}
		c.JSON(201, s)
	})
	g.GET("/snapshots/:id/pages/:page", func(c *gin.Context) {
		n, e := strconv.Atoi(c.Param("page"))
		if e != nil {
			c.JSON(400, gin.H{"code": "INVALID_PAGE"})
			return
		}
		page, e := p.SnapshotPage(c.Request.Context(), c.GetString("uid"), c.Query("epoch"), c.Param("id"), n)
		if e != nil {
			respondError(c, e)
			return
		}
		c.JSON(200, page)
	})
	g.GET("/connect", func(c *gin.Context) { connect(c, p) })
	g.GET("/legacy-proof", func(c *gin.Context) {
		proof, e := p.LegacyProof(c.Request.Context(), c.GetString("uid"), c.Query("epoch"), c.Query("base"))
		if e != nil {
			respondError(c, e)
			return
		}
		c.JSON(200, proof)
	})
}
func body(c *gin.Context, dst interface{}) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if decoder.Decode(dst) != nil || decoder.Decode(new(interface{})) != io.EOF {
		c.JSON(400, gin.H{"code": "INVALID_REQUEST"})
		return false
	}
	return true
}
func respondError(c *gin.Context, e error) {
	code := canonical.ErrorCode(e)
	status := 400
	switch code {
	case "RESET_REQUIRED", "SNAPSHOT_EXPIRED":
		status = 410
	case "CURSOR_FORBIDDEN":
		status = 403
	case "ACCOUNT_NOT_READY", "UPDATE_REQUIRED", "DEVICE_REVOKED", "DEVICE_NOT_REGISTERED":
		status = 409
	case "SNAPSHOT_LIMIT":
		status = 429
	case "SYNC_DISABLED", "SYNC_UNAVAILABLE", "LOG_GAP":
		status = 503
	}
	c.JSON(status, gin.H{"code": code})
}
func auth(secret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		parts := strings.Fields(c.GetHeader("Authorization"))
		if len(secret) < 32 || len(parts) != 2 || parts[0] != "Bearer" {
			c.AbortWithStatusJSON(401, gin.H{"code": "UNAUTHORIZED"})
			return
		}
		token, e := jwt.Parse(parts[1], func(t *jwt.Token) (interface{}, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("invalid algorithm")
			}
			return secret, nil
		})
		if e != nil || !token.Valid {
			c.AbortWithStatusJSON(401, gin.H{"code": "UNAUTHORIZED"})
			return
		}
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok || !claims.VerifyExpiresAt(time.Now().Unix(), true) || claims["authorized"] != true {
			c.AbortWithStatusJSON(401, gin.H{"code": "UNAUTHORIZED"})
			return
		}
		uid, ok := claims["uid"].(string)
		if !ok || strings.TrimSpace(uid) == "" || claims["admin"] == true {
			c.AbortWithStatusJSON(403, gin.H{"code": "USER_REQUIRED"})
			return
		}
		c.Set("uid", uid)
		c.Set("expires", claims["exp"])
		c.Next()
	}
}

// DB high-watermark polling works across API instances and missed local
// notifications. WS contains invalidations only, never the state source.
func connect(c *gin.Context, p *canonical.Protocol) {
	a, e := p.Account(c.Request.Context(), c.GetString("uid"))
	if e != nil {
		respondError(c, e)
		return
	}
	if a.Mode != "v2" || a.Epoch != c.Query("epoch") {
		c.JSON(409, gin.H{"code": "RESET_REQUIRED"})
		return
	}
	upgrader := websocket.Upgrader{}
	conn, e := upgrader.Upgrade(c.Writer, c.Request, nil)
	if e != nil {
		return
	}
	defer conn.Close()
	alerts, unsubscribe := releasealerts.Subscribe()
	defer unsubscribe()
	conn.SetReadLimit(1024)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			if _, _, e := conn.ReadMessage(); e != nil {
				return
			}
		}
	}()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	last := ""
	for {
		expiry, _ := c.Get("expires")
		exp, _ := expiry.(float64)
		if float64(time.Now().Unix()) >= exp {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		a, e = p.Account(ctx, c.GetString("uid"))
		cancel()
		if e != nil || a.Mode != "v2" || a.Epoch != c.Query("epoch") {
			return
		}
		if last != a.Last {
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if e = conn.WriteJSON(gin.H{"topic": "sync.available", "epoch": a.Epoch, "highWatermark": a.Last}); e != nil {
				return
			}
			last = a.Last
		}
		select {
		case alert := <-alerts:
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if conn.WriteJSON(alert) != nil {
				return
			}
		case <-closed:
			return
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
