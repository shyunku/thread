package canonical

import (
	"database/sql"
	"math/big"
	"strconv"
)

var rankGap = new(big.Int).Lsh(big.NewInt(1), 32)
var rankMax = new(big.Int).Sub(new(big.Int).Exp(big.NewInt(10), big.NewInt(65), nil), big.NewInt(1))

func between(left, right *big.Int) (string, bool) {
	var result *big.Int
	switch {
	case left == nil && right == nil:
		result = new(big.Int).Set(rankGap)
	case left == nil:
		result = new(big.Int).Sub(right, rankGap)
	case right == nil:
		result = new(big.Int).Add(left, rankGap)
	default:
		distance := new(big.Int).Sub(right, left)
		if distance.Cmp(big.NewInt(1)) <= 0 {
			return "", false
		}
		result = new(big.Int).Add(left, new(big.Int).Quo(distance, big.NewInt(2)))
	}
	if new(big.Int).Abs(new(big.Int).Set(result)).Cmp(rankMax) > 0 {
		return "", false
	}
	return result.String(), true
}
func parseRank(value string) (*big.Int, error) {
	n, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, fail("INVALID_STORED_RANK")
	}
	return n, nil
}
func (c *mutationContext) rankQuery(query string, args ...interface{}) (*big.Int, error) {
	var raw string
	e := c.tx.QueryRowContext(c.ctx, query, args...).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	return parseRank(raw)
}
func (c *mutationContext) newRank(moving, anchor string, after bool) (string, error) {
	for attempt := 0; attempt < 2; attempt++ {
		var left, right *big.Int
		var e error
		if anchor == "" {
			left, e = c.rankQuery("SELECT sort_rank FROM tasks WHERE user_id=? AND deleted_at IS NULL AND id<>? ORDER BY sort_rank DESC,id DESC LIMIT 1", c.user, moving)
		} else {
			row, err := c.live("task", anchor, "")
			if err != nil {
				return "", fail("ANCHOR_DELETED_OR_MISSING")
			}
			current, err := parseRank(row.fields["sort_rank"].(string))
			if err != nil {
				return "", err
			}
			op, dir := "<", "DESC"
			if after {
				op, dir = ">", "ASC"
			}
			neighbor, err := c.rankQuery("SELECT sort_rank FROM tasks WHERE user_id=? AND deleted_at IS NULL AND id<>? AND (sort_rank"+op+"? OR (sort_rank=? AND id"+op+"?)) ORDER BY sort_rank "+dir+",id "+dir+" LIMIT 1", c.user, moving, current.String(), current.String(), anchor)
			if err != nil {
				return "", err
			}
			if after {
				left, right = current, neighbor
			} else {
				left, right = neighbor, current
			}
		}
		if e != nil {
			return "", e
		}
		if rank, ok := between(left, right); ok {
			return rank, nil
		}
		if attempt == 0 {
			if e = c.rebalance(); e != nil {
				return "", e
			}
		}
	}
	return "", fail("ORDER_MAINTENANCE_REQUIRED")
}
func (c *mutationContext) rebalance() error {
	ids, e := c.ids("SELECT id FROM tasks WHERE user_id=? AND deleted_at IS NULL ORDER BY sort_rank,id LIMIT 50001", c.user)
	if e != nil {
		return e
	}
	if len(ids) > 50000 {
		return fail("ORDER_MAINTENANCE_REQUIRED")
	}
	for i, id := range ids {
		row, e := c.live("task", id, "")
		if e != nil {
			return e
		}
		rank := new(big.Int).Mul(big.NewInt(int64(i+1)), rankGap).String()
		if row.fields["sort_rank"] != rank {
			if e = c.update(row, map[string]interface{}{"sort_rank": rank}, false); e != nil {
				return e
			}
		}
	}
	return nil
}
func nextGeneration(value string) (string, error) {
	n, e := strconv.ParseUint(value, 10, 64)
	if e != nil {
		return "", e
	}
	if n == ^uint64(0) {
		return "", fail("GENERATION_EXHAUSTED")
	}
	return strconv.FormatUint(n+1, 10), nil
}
