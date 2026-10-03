package v3

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"net/http"
	"thread_api/service/pairing"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/gin-gonic/gin"
)

var pairingDecoder, _ = cbor.DecOptions{
	DupMapKey:         cbor.DupMapKeyEnforcedAPF,
	ExtraReturnErrors: cbor.ExtraDecErrorUnknownField,
	MaxMapPairs:       16,
}.DecMode()

type pairingBody struct {
	SessionID   string `cbor:"sessionId"`
	VaultID     string `cbor:"vaultId"`
	Fingerprint string `cbor:"fingerprint"`
	Commitment  []byte `cbor:"commitment"`
	Request     []byte `cbor:"request"`
	Nonce       []byte `cbor:"nonce"`
	Transfer    []byte `cbor:"transfer"`
}

// RegisterPairing relays device-connection sessions between devices of one account.
// The devices verify every value themselves; see service/pairing.
func RegisterPairing(r *gin.Engine, s pairing.Store, secret []byte) {
	g := r.Group("/v3/pairing/session", UserPrincipal(secret))
	respond := func(c *gin.Context, value interface{}, err error) {
		switch {
		case err == nil && value == nil:
			c.Status(http.StatusNoContent)
		case err == nil:
			c.JSON(http.StatusOK, value)
		case errors.Is(err, pairing.ErrInvalid):
			c.JSON(http.StatusBadRequest, gin.H{"code": "INVALID_PAIRING"})
		case errors.Is(err, pairing.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"code": "PAIRING_NOT_FOUND"})
		case errors.Is(err, pairing.ErrConflict):
			c.JSON(http.StatusConflict, gin.H{"code": "PAIRING_CONFLICT"})
		default:
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": "PAIRING_UNAVAILABLE"})
		}
	}
	read := func(c *gin.Context) (pairingBody, bool) {
		var body pairingBody
		media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || media != "application/cbor" {
			c.AbortWithStatusJSON(http.StatusUnsupportedMediaType, gin.H{"code": "CBOR_REQUIRED"})
			return body, false
		}
		raw, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, pairing.MaxTransfer+4096))
		if err != nil {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{"code": "REQUEST_TOO_LARGE"})
			return body, false
		}
		if err := pairingDecoder.Unmarshal(raw, &body); err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": "INVALID_PAIRING"})
			return body, false
		}
		return body, true
	}
	uid := func(c *gin.Context) string { return c.GetString("uid") }

	g.POST("", func(c *gin.Context) {
		body, ok := read(c)
		if !ok {
			return
		}
		id := make([]byte, 16)
		if _, err := rand.Read(id); err != nil {
			respond(c, nil, err)
			return
		}
		session := pairing.Session{SessionID: hex.EncodeToString(id), VaultID: body.VaultID, Fingerprint: body.Fingerprint,
			Commitment: body.Commitment, ExpiresAt: time.Now().Add(pairing.TTL).UnixMilli()}
		if err := s.Create(c.Request.Context(), uid(c), session); err != nil {
			respond(c, nil, err)
			return
		}
		respond(c, gin.H{"sessionId": session.SessionID, "expiresAt": session.ExpiresAt}, nil)
	})
	g.GET("", func(c *gin.Context) {
		session, err := s.Get(c.Request.Context(), uid(c))
		if err != nil {
			respond(c, nil, err)
			return
		}
		respond(c, session, nil)
	})
	step := func(path string, run func(*gin.Context, pairingBody) error) {
		g.POST(path, func(c *gin.Context) {
			body, ok := read(c)
			if !ok {
				return
			}
			respond(c, nil, run(c, body))
		})
	}
	step("/request", func(c *gin.Context, b pairingBody) error {
		return s.SubmitRequest(c.Request.Context(), uid(c), b.SessionID, b.Request, b.Nonce)
	})
	step("/reveal", func(c *gin.Context, b pairingBody) error {
		return s.Reveal(c.Request.Context(), uid(c), b.SessionID, b.Nonce)
	})
	step("/transfer", func(c *gin.Context, b pairingBody) error {
		return s.SubmitTransfer(c.Request.Context(), uid(c), b.SessionID, b.Transfer)
	})
	step("/cancel", func(c *gin.Context, b pairingBody) error {
		return s.Cancel(c.Request.Context(), uid(c), b.SessionID)
	})
}
