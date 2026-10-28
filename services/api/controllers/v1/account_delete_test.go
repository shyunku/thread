package v1

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"
	"thread_api/service/session"
	"time"
)

// fakeAccounts stands in for the database: Delete removes the account and the
// refresh path's account lookup reads the same set.
type fakeAccounts struct {
	mu      sync.Mutex
	live    map[string]bool
	err     error
	calls   int
	pairing []string
	streams []string
	pairErr error
}

func (f *fakeAccounts) Delete(_ context.Context, uid string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return f.err
	}
	delete(f.live, uid)
	return nil
}

func useAccounts(t *testing.T, uids ...string) *fakeAccounts {
	t.Helper()
	f := &fakeAccounts{live: map[string]bool{}}
	for _, uid := range uids {
		f.live[uid] = true
	}
	previousAccounts, previousLookup := Accounts, lookupAccount
	previousPairing, previousStreams := DeleteAccountPairing, CloseAccountStreams
	Accounts = f
	lookupAccount = func(uid string) (bool, error) {
		if uid == adminTokenSubject {
			return true, nil
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		return f.live[uid], nil
	}
	DeleteAccountPairing = func(_ context.Context, uid string) error {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.pairErr != nil {
			return f.pairErr
		}
		f.pairing = append(f.pairing, uid)
		return nil
	}
	CloseAccountStreams = func(uid string) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.streams = append(f.streams, uid)
	}
	t.Cleanup(func() {
		Accounts, lookupAccount = previousAccounts, previousLookup
		DeleteAccountPairing, CloseAccountStreams = previousPairing, previousStreams
	})
	return f
}

func loginAs(t *testing.T, uid string) *authTokenDto {
	t.Helper()
	auth, err := issueSession(context.Background(), uid, false)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func deleteAccount(t *testing.T, access, body string) sessionCall {
	r := sessionRouter()
	return call(t, r, http.MethodPost, "/v1/auth/account/delete", map[string]string{"Authorization": "Bearer " + access}, body)
}

func TestDeleteAccountRejectsAdmin(t *testing.T) {
	sessionTestEnv(t)
	accounts := useAccounts(t)
	admin := login(t)
	if got := deleteAccount(t, admin.AccessToken.Token, "{}"); got.status != http.StatusForbidden || got.code != "USER_REQUIRED" {
		t.Fatalf("admin delete: %+v", got)
	}
	if accounts.calls != 0 {
		t.Fatal("admin reached the deleter")
	}
	if got := protected(t, sessionRouter(), admin.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("admin session changed: %d", got.status)
	}
}

func TestDeleteAccountEndsEverySession(t *testing.T) {
	sessionTestEnv(t)
	accounts := useAccounts(t, "user-a", "user-b")
	r := sessionRouter()
	mine, other, bystander := loginAs(t, "user-a"), loginAs(t, "user-a"), loginAs(t, "user-b")

	if got := deleteAccount(t, mine.AccessToken.Token, "{}"); got.status != http.StatusNoContent {
		t.Fatalf("delete: %+v", got)
	}
	if accounts.live["user-a"] || !accounts.live["user-b"] {
		t.Fatal("wrong account deleted")
	}
	if len(accounts.pairing) != 1 || accounts.pairing[0] != "user-a" || len(accounts.streams) != 1 || accounts.streams[0] != "user-a" {
		t.Fatalf("cleanup: pairing %v streams %v", accounts.pairing, accounts.streams)
	}
	// Every session of the account ends, including the one that asked.
	for _, auth := range []*authTokenDto{mine, other} {
		if got := protected(t, r, auth.AccessToken.Token); got.status != http.StatusUnauthorized || got.code != "SESSION_REVOKED" {
			t.Fatalf("access after delete: %+v", got)
		}
		// Another device learns the account is gone when it refreshes.
		if got := refresh(t, r, auth.RefreshToken.Token); got.status != http.StatusUnauthorized || got.code != "ACCOUNT_DELETED" {
			t.Fatalf("refresh after delete: %+v", got)
		}
	}
	// Other accounts are untouched.
	if got := protected(t, r, bystander.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("other account's session: %d", got.status)
	}
	if got := refresh(t, r, bystander.RefreshToken.Token); got.status != http.StatusOK {
		t.Fatalf("other account's refresh: %+v", got)
	}
}

func TestDeleteAccountWithoutBody(t *testing.T) {
	sessionTestEnv(t)
	useAccounts(t, "user-a")
	auth := loginAs(t, "user-a")
	if got := deleteAccount(t, auth.AccessToken.Token, ""); got.status != http.StatusNoContent {
		t.Fatalf("delete without body: %+v", got)
	}
}

func TestDeleteAccountRejectsMalformedBody(t *testing.T) {
	sessionTestEnv(t)
	accounts := useAccounts(t, "user-a")
	auth := loginAs(t, "user-a")
	for _, body := range []string{"[]", "null", "nope", `{"a":`} {
		if got := deleteAccount(t, auth.AccessToken.Token, body); got.status != http.StatusBadRequest || got.code != "INVALID_REQUEST" {
			t.Fatalf("body %q: %+v", body, got)
		}
	}
	if accounts.calls != 0 || !accounts.live["user-a"] {
		t.Fatal("malformed request deleted the account")
	}
}

func TestDeleteAccountDatabaseFailureKeepsSessions(t *testing.T) {
	sessionTestEnv(t)
	accounts := useAccounts(t, "user-a")
	accounts.err = errors.New("database down")
	auth := loginAs(t, "user-a")
	if got := deleteAccount(t, auth.AccessToken.Token, "{}"); got.status != http.StatusServiceUnavailable || got.code != "DELETE_UNAVAILABLE" {
		t.Fatalf("database failure: %+v", got)
	}
	if got := protected(t, sessionRouter(), auth.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("session ended without a delete: %d", got.status)
	}
	if len(accounts.pairing)+len(accounts.streams) != 0 {
		t.Fatal("cleanup ran without a delete")
	}

	Accounts = nil
	if got := deleteAccount(t, auth.AccessToken.Token, "{}"); got.status != http.StatusServiceUnavailable || got.code != "DELETE_UNAVAILABLE" {
		t.Fatalf("no deleter: %+v", got)
	}
}

// failingRevoke is a session store whose RevokeUser fails until fixed.
type failingRevoke struct {
	*session.Memory
	fail bool
}

func (f *failingRevoke) RevokeUser(ctx context.Context, uid, keep string, ttl time.Duration) error {
	if f.fail {
		return errors.New("redis down")
	}
	return f.Memory.RevokeUser(ctx, uid, keep, ttl)
}

// After the database commit a session store failure answers an error, and the
// client's retry with the same session finishes the job.
func TestDeleteAccountRetriesAfterSessionStoreFailure(t *testing.T) {
	store := &failingRevoke{Memory: sessionTestEnv(t), fail: true}
	useSessions(t, store)
	accounts := useAccounts(t, "user-a")
	auth := loginAs(t, "user-a")

	if got := deleteAccount(t, auth.AccessToken.Token, "{}"); got.status != http.StatusServiceUnavailable || got.code != "SESSION_UNAVAILABLE" {
		t.Fatalf("revoke failure: %+v", got)
	}
	if accounts.live["user-a"] {
		t.Fatal("account not deleted")
	}
	if len(accounts.streams) != 0 {
		t.Fatal("streams closed before sessions were revoked")
	}
	accounts.pairErr = errors.New("redis down")
	if got := deleteAccount(t, auth.AccessToken.Token, "{}"); got.status != http.StatusServiceUnavailable || got.code != "SESSION_UNAVAILABLE" {
		t.Fatalf("pairing failure: %+v", got)
	}

	store.fail, accounts.pairErr = false, nil
	if got := deleteAccount(t, auth.AccessToken.Token, "{}"); got.status != http.StatusNoContent {
		t.Fatalf("retry: %+v", got)
	}
	if accounts.calls != 3 {
		t.Fatalf("deleter calls: %d", accounts.calls)
	}
	if got := protected(t, sessionRouter(), auth.AccessToken.Token); got.code != "SESSION_REVOKED" {
		t.Fatalf("session after retry: %+v", got)
	}
	if got := refresh(t, sessionRouter(), auth.RefreshToken.Token); got.code != "ACCOUNT_DELETED" {
		t.Fatalf("refresh after retry: %+v", got)
	}
}
