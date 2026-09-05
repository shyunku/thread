package canonical

import (
	"context"
	"encoding/json"
	"strconv"
	"thread_api/service/syncmigration"
)

type LegacyProof struct {
	Epoch          string                    `json:"epoch"`
	UserID         string                    `json:"userId"`
	SourceChecksum string                    `json:"sourceChecksum"`
	BaseNumber     string                    `json:"baseNumber,omitempty"`
	Blocks         []syncmigration.BlockMeta `json:"blocks"`
	BaseRows       *syncmigration.Rows       `json:"baseRows,omitempty"`
}

// The legacy writer fence makes this retained history immutable for v2 accounts.
// Never consult the legacy chain cache when classifying a local pending change.
func (p *Protocol) LegacyProof(ctx context.Context, uid, epoch, base string) (LegacyProof, error) {
	result := LegacyProof{Epoch: epoch, UserID: uid}
	a, e := p.Account(ctx, uid)
	if e != nil {
		return result, e
	}
	if e = p.ready(a, epoch); e != nil {
		return result, e
	}
	source, e := syncmigration.ReadSource(ctx, p.Store.DB, uid)
	if e != nil {
		return result, fail("LEGACY_SOURCE_INVALID")
	}
	plan, e := syncmigration.BuildPlan(source)
	if e != nil {
		return result, fail("LEGACY_SOURCE_INVALID")
	}
	result.SourceChecksum = plan.SourceChecksum
	result.Blocks = plan.LegacyBlocks
	if base != "" {
		n, e := strconv.ParseInt(base, 10, 64)
		if e != nil || n < 0 || n > source.SnapshotNumber {
			return result, fail("INVALID_LEGACY_BASE")
		}
		source.SnapshotNumber = n
		var blocks []syncmigration.BlockMeta
		for _, b := range source.Blocks {
			if b.Number <= n {
				blocks = append(blocks, b)
			}
		}
		source.Blocks = blocks
		if n == 0 {
			source.Snapshot = json.RawMessage(`{"tasks":{},"categories":{}}`)
		} else {
			var count int
			var size int64
			if e = p.Store.DB.QueryRowContext(ctx, "SELECT COUNT(*),COALESCE(MAX(OCTET_LENGTH(state)),0) FROM blocks WHERE uid=? AND block_number=?", uid, n).Scan(&count, &size); e != nil || count != 1 || size < 1 || size > syncmigration.MaxSnapshotBytes {
				return result, fail("INVALID_LEGACY_BASE")
			}
			if e = p.Store.DB.QueryRowContext(ctx, "SELECT state FROM blocks WHERE uid=? AND block_number=?", uid, n).Scan(&source.Snapshot); e != nil {
				return result, e
			}
		}
		basePlan, e := syncmigration.BuildPlan(source)
		if e != nil {
			return result, fail("INVALID_LEGACY_BASE")
		}
		result.BaseRows = &basePlan.Rows
		result.BaseNumber = strconv.FormatInt(basePlan.SnapshotNumber, 10)
	}
	check, e := p.Account(ctx, uid)
	if e != nil {
		return result, e
	}
	if e = p.ready(check, epoch); e != nil {
		return result, e
	}
	return result, nil
}
