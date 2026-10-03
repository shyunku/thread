package pairing

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// One hash per account: thread:pairing:<uid> {sessionId, vaultId, fingerprint,
// commitment, request, nonceN, nonceE, transfer, expiresAt}. The key expires with
// the session; later steps never extend it.
type Redis struct {
	client redis.Cmdable
}

func NewRedis(client redis.Cmdable) *Redis { return &Redis{client: client} }

func key(uid string) string { return "thread:pairing:" + uid }

func (r *Redis) Create(ctx context.Context, uid string, s Session) error {
	if err := ValidateNew(s); err != nil {
		return err
	}
	k := key(uid)
	_, err := r.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.Del(ctx, k)
		p.HSet(ctx, k, "sessionId", s.SessionID, "vaultId", s.VaultID, "fingerprint", s.Fingerprint,
			"commitment", s.Commitment, "expiresAt", strconv.FormatInt(s.ExpiresAt, 10))
		p.PExpireAt(ctx, k, time.UnixMilli(s.ExpiresAt))
		return nil
	})
	return err
}

func (r *Redis) Get(ctx context.Context, uid string) (Session, error) {
	values, err := r.client.HGetAll(ctx, key(uid)).Result()
	if err != nil {
		return Session{}, err
	}
	if values["sessionId"] == "" {
		return Session{}, ErrNotFound
	}
	expires, _ := strconv.ParseInt(values["expiresAt"], 10, 64)
	bytes := func(name string) []byte {
		if v, ok := values[name]; ok {
			return []byte(v)
		}
		return nil
	}
	return Session{
		SessionID: values["sessionId"], VaultID: values["vaultId"], Fingerprint: values["fingerprint"],
		Commitment: bytes("commitment"), Request: bytes("request"), NonceN: bytes("nonceN"),
		NonceE: bytes("nonceE"), Transfer: bytes("transfer"), ExpiresAt: expires,
	}, nil
}

// step writes fields only when the session is the expected one, the required
// field exists and the target field does not.
var stepScript = redis.NewScript(`
if redis.call("HGET", KEYS[1], "sessionId") ~= ARGV[1] then return "missing" end
if ARGV[2] ~= "" and redis.call("HEXISTS", KEYS[1], ARGV[2]) == 0 then return "conflict" end
if redis.call("HEXISTS", KEYS[1], ARGV[3]) == 1 then return "conflict" end
for i = 3, #ARGV, 2 do redis.call("HSET", KEYS[1], ARGV[i], ARGV[i + 1]) end
return "ok"
`)

func (r *Redis) step(ctx context.Context, uid, sessionID, requires string, fields ...interface{}) error {
	args := append([]interface{}{sessionID, requires}, fields...)
	result, err := stepScript.Run(ctx, r.client, []string{key(uid)}, args...).Text()
	if err != nil {
		return err
	}
	switch result {
	case "ok":
		return nil
	case "missing":
		return ErrNotFound
	case "conflict":
		return ErrConflict
	}
	return errors.New("unexpected pairing result")
}

func (r *Redis) SubmitRequest(ctx context.Context, uid, sessionID string, request, nonce []byte) error {
	if !ValidSessionID(sessionID) || !ValidRequest(request, nonce) {
		return ErrInvalid
	}
	return r.step(ctx, uid, sessionID, "", "request", request, "nonceN", nonce)
}

func (r *Redis) Reveal(ctx context.Context, uid, sessionID string, nonce []byte) error {
	if !ValidSessionID(sessionID) || !ValidNonce(nonce) {
		return ErrInvalid
	}
	return r.step(ctx, uid, sessionID, "request", "nonceE", nonce)
}

func (r *Redis) SubmitTransfer(ctx context.Context, uid, sessionID string, transfer []byte) error {
	if !ValidSessionID(sessionID) || !ValidTransfer(transfer) {
		return ErrInvalid
	}
	return r.step(ctx, uid, sessionID, "nonceE", "transfer", transfer)
}

var cancelScript = redis.NewScript(`
if redis.call("HGET", KEYS[1], "sessionId") == ARGV[1] then redis.call("DEL", KEYS[1]) end
return 1
`)

func (r *Redis) Cancel(ctx context.Context, uid, sessionID string) error {
	if !ValidSessionID(sessionID) {
		return ErrInvalid
	}
	return cancelScript.Run(ctx, r.client, []string{key(uid)}, sessionID).Err()
}
