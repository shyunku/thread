package session

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const prefix = "thread:session:"

// Redis keys:
//
//	rt:<hash>         hash {uid, sid}             current refresh token of a session
//	used:<hash>       hash {uid, sid, at, next}   rotated token, kept until it would have expired
//	sid:<sid>         uid                         session is active
//	user:<uid>        set of sid                  sessions of an account
//	legacy-off:<uid>  "1"                         tokens without a session are refused
type Redis struct {
	client redis.Cmdable
}

func NewRedis(client redis.Cmdable) *Redis {
	return &Redis{client: client}
}

func rtKey(hash string) string       { return prefix + "rt:" + hash }
func usedKey(hash string) string     { return prefix + "used:" + hash }
func sidKey(sid string) string       { return prefix + "sid:" + sid }
func userKey(uid string) string      { return prefix + "user:" + uid }
func legacyOffKey(uid string) string { return prefix + "legacy-off:" + uid }

func millis(d time.Duration) int64 {
	if ms := d.Milliseconds(); ms > 0 {
		return ms
	}
	return 1
}

func (r *Redis) Create(ctx context.Context, info Info, hash string, ttl time.Duration) error {
	_, err := r.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		p.HSet(ctx, rtKey(hash), "uid", info.UID, "sid", info.SID)
		p.PExpire(ctx, rtKey(hash), ttl)
		p.Set(ctx, sidKey(info.SID), info.UID, ttl)
		p.SAdd(ctx, userKey(info.UID), info.SID)
		p.PExpire(ctx, userKey(info.UID), ttl)
		return nil
	})
	return err
}

func (r *Redis) Resolve(ctx context.Context, hash string) (Info, State, error) {
	for _, candidate := range []struct {
		key   string
		state State
	}{{rtKey(hash), Current}, {usedKey(hash), Rotated}} {
		values, err := r.client.HMGet(ctx, candidate.key, "uid", "sid").Result()
		if err != nil {
			return Info{}, 0, err
		}
		uid, _ := values[0].(string)
		sid, _ := values[1].(string)
		if uid != "" && sid != "" {
			return Info{UID: uid, SID: sid}, candidate.state, nil
		}
	}
	return Info{}, 0, ErrNotFound
}

var rotateScript = redis.NewScript(`
if redis.call("GET", KEYS[4]) ~= ARGV[1] then return "missing" end
local cur = redis.call("HMGET", KEYS[1], "uid", "sid")
if cur[1] then
  if cur[1] ~= ARGV[1] or cur[2] ~= ARGV[2] then return "missing" end
  local left = redis.call("PTTL", KEYS[1])
  if left < 1 then left = tonumber(ARGV[5]) end
  redis.call("DEL", KEYS[1])
  redis.call("HSET", KEYS[2], "uid", ARGV[1], "sid", ARGV[2], "at", ARGV[3], "next", ARGV[7])
  redis.call("PEXPIRE", KEYS[2], left)
else
  local used = redis.call("HMGET", KEYS[2], "uid", "sid", "at", "next")
  if not used[1] or used[1] ~= ARGV[1] or used[2] ~= ARGV[2] then return "missing" end
  local nextKey = ARGV[6] .. used[4]
  if tonumber(ARGV[3]) - tonumber(used[3]) > tonumber(ARGV[4]) or redis.call("HGET", nextKey, "sid") ~= ARGV[2] then
    redis.call("DEL", KEYS[4], nextKey)
    redis.call("SREM", KEYS[5], ARGV[2])
    return "reused"
  end
  redis.call("DEL", nextKey)
  redis.call("HSET", KEYS[2], "next", ARGV[7])
end
redis.call("HSET", KEYS[3], "uid", ARGV[1], "sid", ARGV[2])
redis.call("PEXPIRE", KEYS[3], ARGV[5])
redis.call("PEXPIRE", KEYS[4], ARGV[5])
redis.call("SADD", KEYS[5], ARGV[2])
redis.call("PEXPIRE", KEYS[5], ARGV[5])
return "ok"
`)

func (r *Redis) Rotate(ctx context.Context, info Info, oldHash, newHash string, ttl time.Duration, now time.Time) error {
	result, err := rotateScript.Run(ctx, r.client,
		[]string{rtKey(oldHash), usedKey(oldHash), rtKey(newHash), sidKey(info.SID), userKey(info.UID)},
		info.UID, info.SID, now.UnixMilli(), ReuseGrace.Milliseconds(), millis(ttl), prefix+"rt:", newHash,
	).Text()
	if err != nil {
		return err
	}
	switch result {
	case "ok":
		return nil
	case "reused":
		return ErrReused
	case "missing":
		return ErrNotFound
	}
	return errors.New("unexpected session rotation result")
}

var revokeScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("DEL", KEYS[1]) end
redis.call("SREM", KEYS[2], ARGV[2])
return 1
`)

func (r *Redis) Revoke(ctx context.Context, info Info) error {
	return revokeScript.Run(ctx, r.client, []string{sidKey(info.SID), userKey(info.UID)}, info.UID, info.SID).Err()
}

var revokeUserScript = redis.NewScript(`
for _, sid in ipairs(redis.call("SMEMBERS", KEYS[1])) do
  if sid ~= ARGV[1] then
    local key = ARGV[2] .. sid
    if redis.call("GET", key) == ARGV[4] then redis.call("DEL", key) end
    redis.call("SREM", KEYS[1], sid)
  end
end
redis.call("SET", KEYS[2], "1", "PX", ARGV[3])
return 1
`)

func (r *Redis) RevokeUser(ctx context.Context, uid, keepSID string, ttl time.Duration) error {
	return revokeUserScript.Run(ctx, r.client, []string{userKey(uid), legacyOffKey(uid)},
		keepSID, prefix+"sid:", millis(ttl), uid).Err()
}

func (r *Redis) Active(ctx context.Context, uid, sid string) (bool, error) {
	if sid == "" {
		off, err := r.client.Exists(ctx, legacyOffKey(uid)).Result()
		return off == 0, err
	}
	value, err := r.client.Get(ctx, sidKey(sid)).Result()
	if errors.Is(err, redis.Nil) {
		return false, nil
	}
	return err == nil && value == uid, err
}

var takeLegacyScript = redis.NewScript(`
if redis.call("EXISTS", KEYS[2]) == 1 then return 0 end
if redis.call("TYPE", KEYS[1]).ok ~= "string" or redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`)

func (r *Redis) TakeLegacy(ctx context.Context, raw, uid string) (bool, error) {
	// Old refresh tokens were stored under their raw value. Never touch session keys.
	if raw == "" || strings.HasPrefix(raw, prefix) {
		return false, nil
	}
	n, err := takeLegacyScript.Run(ctx, r.client, []string{raw, legacyOffKey(uid)}, uid).Int()
	return n == 1, err
}

func (r *Redis) DropLegacy(ctx context.Context, raw, uid string) error {
	_, err := r.TakeLegacy(ctx, raw, uid)
	return err
}
