package v3

import "context"

// DeleteAccountPairing removes a deleted account's pairing session. It is safe
// to repeat.
func DeleteAccountPairing(ctx context.Context, uid string) error {
	if pairingStore == nil {
		return nil
	}
	return pairingStore.DeleteAccount(ctx, uid)
}

// CloseAccountStreams ends a deleted account's open sync event streams.
func CloseAccountStreams(uid string) {
	if syncBroker != nil {
		syncBroker.Close(uid)
	}
}
