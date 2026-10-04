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
} = require('@thread/e2ee/src/accountSessions');

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
  #listener: ((user: AccountUser | null) => void) | null = null;

  constructor({
    api,
    storage,
    endpoint,
    fetch,
  }: {
    api: AuthApi;
    storage: AccountStorage;
    endpoint: string;
    fetch: any;
  }) {
    this.#api = api;
    this.#storage = storage;
    this.#endpoint = endpoint;
    this.#fetch = fetch;
  }

  onChange(listener: ((user: AccountUser | null) => void) | null) {
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
      throw error;
    }
    if (this.#current !== current) throw new AuthError('AUTH_REQUIRED');
    this.#current = { user: current.user, tokens: next };
    await this.#storage.save(this.#current);
    return next.accessToken;
  }

  async #endLocally() {
    this.#current = null;
    await this.#storage.clear();
    this.#listener?.(null);
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
