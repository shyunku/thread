package syncmigration

import "testing"

func TestRejectsRepeatedHashAcrossDifferentBlocks(t *testing.T) {
	for _, repeatTx := range []bool{true, false} {
		source := sourceOf(fixture())
		next := source.Blocks[0]
		next.Number = 2
		if repeatTx {
			next.BlockHash = "new-block"
		} else {
			next.TxHash = "new-tx"
		}
		source.Blocks = append(source.Blocks, next)
		source.SnapshotNumber = 2
		if _, e := BuildPlan(source); e == nil {
			t.Fatal("ambiguous repeated provenance accepted")
		}
	}
}
