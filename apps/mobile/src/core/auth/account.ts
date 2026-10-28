import type {
  AccountUser,
  AuthApi,
  AuthResult,
  AuthTokens,
  GoogleLinkRequired,
} from './api';
import { AuthError } from './api';

const {
  logout,
  revokeOtherSessions,
  deleteAccount,
} = require('@thread/e2ee/src/accountSessions');

// Why the account left this phone, for the login screen (#92):
// deleted = deleted here, deletedElsewhere = a refresh answered ACCOUNT_DELETED.
export type SignedOutReason = 'deleted' | 'deletedElsewhere';
export type AccountListener = (
  user: AccountUser | null,
  reason?: SignedOutReason,
) => void;

// Where the signed-in account lives on the device (Keystore-backed, no prompt:
// tokens are needed for background sync; the vault key is protected separately).
export interface AccountStorage {
  load(): Promise<{ user: AccountUser; tokens: AuthTokens } | null>;
  save(value: { user: AccountUser; tokens: AuthTokens }): Promise<void>;
  clear(): Promise<void>;
}

// The signed-in account and its tokens. `renew` follows the server's refresh
// rotation (#72): one renewal at a time, and a reused or revoked refresh token
// ends the local sign-in (AUTH_REQUIRED) instead of retrying.
export class AccountSession {
  #api: AuthApi;
  #storage: AccountStorage;
  #endpoint: string;
  #fetch: any;
  #current: { user: AccountUser; tokens: AuthTokens } | null = null;
  #renewing: Promise<string> | null = null;
  #listener: AccountListener | null = null;
  #forget: ((uid: string) => Promise<void> | void) | null;
  #deleting = false;
  #retryDelay: number;

  constructor({
    api,
    storage,
    endpoint,
    fetch,
    forget,
    retryDelay = 1500,
  }: {
    api: AuthApi;
    storage: AccountStorage;
    endpoint: string;
    fetch: any;
    // Removes what this phone keeps for a deleted account (its vault), #92.
    forget?: (uid: string) => Promise<void> | void;
    retryDelay?: number;
  }) {
    this.#api = api;
    this.#storage = storage;
    this.#endpoint = endpoint;
    this.#fetch = fetch;
    this.#forget = forget ?? null;
    this.#retryDelay = retryDelay;
  }

  onChange(listener: AccountListener | null) {
    this.#listener = listener;
  }

  user(): AccountUser | null {
    return this.#current?.user ?? null;
  }

  async restore(): Promise<AccountUser | null> {
    this.#current = await this.#storage.load();
    this.#listener?.(this.user());
    return this.user();
  }

  async #signIn(result: AuthResult) {
    // A different account on this device must sign out first (its vault stays separate).
    if (this.#current && this.#current.user.uid !== result.user.uid)
      throw new AuthError('ANOTHER_ACCOUNT_SIGNED_IN');
    this.#current = { user: result.user, tokens: result.tokens };
    await this.#storage.save(this.#current);
    this.#listener?.(this.user());
    return result.user;
  }

  signIn(authId: string, password: string) {
    return this.#api
      .login(authId, password)
      .then(result => this.#signIn(result));
  }
  signUp(username: string, authId: string, password: string) {
    return this.#api.signup(username, authId, password);
  }
  // Signed in, or { linkToken } when this Google account is not linked to Thread yet.
  async signInWithGoogle(
    idToken: string,
  ): Promise<AccountUser | GoogleLinkRequired> {
    const result = await this.#api.google(idToken);
    return 'linkToken' in result ? result : this.#signIn(result);
  }

  // Links (existing authId + password) or creates (with username) the account for the
  // Google identity, then signs in with the same Google ID token.
  async linkGoogle(input: {
    idToken: string;
    linkToken: string;
    authId: string;
    password: string;
    username?: string;
  }): Promise<AccountUser> {
    await this.#api.googleLink(input);
    const result = await this.signInWithGoogle(input.idToken);
    if ('linkToken' in result) throw new AuthError('GOOGLE_LINK_FAILED');
    return result;
  }

  // Token source for the shared transport: current() / renew(stale).
  readonly tokens = {
    current: async () => {
      if (!this.#current) throw new AuthError('AUTH_REQUIRED');
      return this.#current.tokens.accessToken;
    },
    renew: (stale: string) => {
      if (!this.#renewing) {
        const running = this.#renew(stale).finally(() => {
          if (this.#renewing === running) this.#renewing = null;
        });
        this.#renewing = running;
      }
      return this.#renewing;
    },
  };

  async #renew(stale: string): Promise<string> {
    const current = this.#current;
    if (!current) throw new AuthError('AUTH_REQUIRED');
    // Someone else already renewed past the token this caller saw.
    if (current.tokens.accessToken !== stale) return current.tokens.accessToken;
    let next: AuthTokens;
    try {
      next = await this.#api.refresh(current.tokens);
    } catch (error: any) {
      if (error?.code === 'UNAUTHORIZED') {
        await this.#endLocally();
        throw new AuthError('AUTH_REQUIRED');
      }
      // Deleted on another device (#92). While deleting here, deleteAccount finishes it.
      if (error?.code === 'ACCOUNT_DELETED') {
        if (!this.#deleting && this.#current === current)
          await this.#gone('deletedElsewhere');
        throw new AuthError('ACCOUNT_DELETED');
      }
      throw error;
    }
    if (this.#current !== current) throw new AuthError('AUTH_REQUIRED');
    this.#current = { user: current.user, tokens: next };
    await this.#storage.save(this.#current);
    return next.accessToken;
  }

  async #endLocally(reason?: SignedOutReason) {
    this.#current = null;
    await this.#storage.clear();
    this.#listener?.(null, reason);
  }

  // The account no longer exists: forget its vault (best effort), then its tokens.
  async #gone(reason: SignedOutReason) {
    const uid = this.#current?.user.uid;
    if (!uid) return;
    try {
      await this.#forget?.(uid);
    } catch {}
    await this.#endLocally(reason);
  }

  // Deletes the account on the server (#92) and then this phone's copy of it. The
  // caller confirms the user first. 503 is retried once (the server call is idempotent).
  async deleteAccount(signal?: AbortSignal) {
    if (!this.#current) throw new AuthError('AUTH_REQUIRED');
    if (this.#deleting) throw new AuthError('VAULT_BUSY');
    this.#deleting = true;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await deleteAccount({
            endpoint: this.#endpoint,
            tokens: this.tokens,
            fetch: this.#fetch,
            signal,
          });
          break;
        } catch (error: any) {
          const code = error?.code ?? error?.message;
          if (
            attempt < 1 &&
            !['UNAUTHORIZED', 'AUTH_REQUIRED', 'ACCOUNT_DELETE_FORBIDDEN'].includes(code)
          ) {
            await new Promise(resolve => setTimeout(resolve, this.#retryDelay));
            continue;
          }
          throw new AuthError(
            ['UNAUTHORIZED', 'AUTH_REQUIRED', 'ACCOUNT_DELETE_FORBIDDEN'].includes(code)
              ? code
              : 'ACCOUNT_DELETE_UNAVAILABLE',
          );
        }
      }
      await this.#gone('deleted');
    } finally {
      this.#deleting = false;
    }
  }

  // Ends this device's server session (best effort) and forgets the tokens.
  async signOut() {
    const refreshToken = this.#current?.tokens.refreshToken;
    if (refreshToken)
      await logout({
        endpoint: this.#endpoint,
        refreshToken,
        fetch: this.#fetch,
      });
    await this.#endLocally();
  }

  // Signs out every other device of this account; this one stays.
  revokeOtherSessions(signal?: AbortSignal) {
    return revokeOtherSessions({
      endpoint: this.#endpoint,
      tokens: this.tokens,
      fetch: this.#fetch,
      signal,
    });
  }
}
