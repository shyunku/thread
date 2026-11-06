package vault

import "time"

// Signed account-control request (purpose "migration"). Only activate-empty
// uses it now; the wire name stays so current clients keep working.
type migrationControl struct {
	record                   Record
	vaultID, deviceID, epoch string
	revision, generation     uint64
	parameters               map[string]interface{}
}

func parseMigrationControl(raw []byte, operation string) (migrationControl, error) {
	var c migrationControl
	r, e := ParseRecord(raw)
	if e != nil {
		return c, e
	}
	c.record = r
	b := r.Body
	c.vaultID, _ = b["vaultId"].(string)
	c.deviceID, _ = b["deviceId"].(string)
	c.epoch, _ = b["epoch"].(string)
	var rok, gok bool
	c.revision, rok = b["membershipRevision"].(uint64)
	c.generation, gok = b["keyGeneration"].(uint64)
	c.parameters, _ = b["parameters"].(map[string]interface{})
	id, _ := b["requestId"].(string)
	expires, ok := b["expiresAt"].(uint64)
	now := uint64(time.Now().UnixMilli())
	if len(b) != 10 || b["schema"] != uint64(1) || b["operation"] != operation || !identifier.MatchString(c.vaultID) || !identifier.MatchString(c.deviceID) || !identifier.MatchString(c.epoch) || !identifier.MatchString(id) || !rok || !gok || c.generation == 0 || c.parameters == nil || !ok || expires <= now || expires > now+300000 {
		return c, ErrInvalid
	}
	return c, nil
}
