import { Buffer } from 'buffer';
import type { FetchLike } from '@/core/net/fetch';

const { createHash } = require('@thread/e2ee/src/platform');

// Same account requests as the desktop (apps/desktop/public/electron/configures/ipc.config.js).
// Password hashing matches the desktop client: the server only ever sees
// sha256(sha256(sha256(id) + password)); the raw password never leaves the device.
const sha256 = (text: string) =>
  createHash('sha256')
    .update(Buffer.from(text, 'utf8'))
    .digest('hex') as string;

export function encryptedPassword(authId: string, password: string) {
  return sha256(sha256(authId) + password);
}

export type AccountUser = {
  uid: string;
  username: string | null;
  authId: string | null;
  googleEmail: string | null;
  profileImageUrl: string | null;
};
export type AuthTokens = { accessToken: string; refreshToken: string };
export type AuthResult = { user: AccountUser; tokens: AuthTokens };
// An unlinked Google account: link an existing account (its password) or sign up.
export type GoogleLinkRequired = { linkToken: string };

export class AuthError extends Error {
  constructor(readonly code: string, readonly status: number | null = null) {
    super(code);
  }
}

// Endpoint rules match the desktop: https, or http only to this device itself
// (the emulator reaches a host dev server through `adb reverse`).
export function apiURL(endpoint: string, path: string) {
  const base = new URL(endpoint);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(
        base.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      ))
  ) {
    throw new AuthError('INSECURE_ENDPOINT');
  }
  return new URL(path, base).href;
}

function token(value: any): string {
  const text = value?.token;
  if (typeof text !== 'string' || !text || text.length > 8192)
    throw new AuthError('INVALID_AUTH_RESPONSE');
  return text;
}

function user(value: any): AccountUser {
  if (
    !value ||
    typeof value.uid !== 'string' ||
    !value.uid.trim() ||
    value.uid.length > 256
  ) {
    throw new AuthError('INVALID_AUTH_RESPONSE');
  }
  const optional = (field: unknown) =>
    typeof field === 'string' && field ? field : null;
  return {
    uid: value.uid,
    username: optional(value.username),
    authId: optional(value.auth_id),
    googleEmail: optional(value.google_email),
    profileImageUrl:
      optional(value.google_profile_image_url) ??
      optional(value.profile_image_url),
  };
}

export function parseAuthResult(body: any): AuthResult {
  return {
    user: user(body?.user),
    tokens: {
      accessToken: token(body?.auth?.access_token),
      refreshToken: token(body?.auth?.refresh_token),
    },
  };
}

export function createAuthApi({
  endpoint,
  fetch,
  timeout = 15000,
}: {
  endpoint: string;
  fetch: FetchLike;
  timeout?: number;
}) {
  async function post(
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(apiURL(endpoint, path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
        redirect: 'error',
      });
      const text = await response.text().catch(() => '');
      if (text.length > 65536)
        throw new AuthError('INVALID_AUTH_RESPONSE', response.status);
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { status: response.status as number, ok: !!response.ok, json };
    } catch (error: any) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(
        controller.signal.aborted ? 'NETWORK_TIMEOUT' : 'NETWORK_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async login(authId: string, password: string): Promise<AuthResult> {
      const { status, ok, json } = await post('/v1/auth/login', {
        auth_id: authId,
        encrypted_password: sha256(encryptedPassword(authId, password)),
      });
      if (!ok)
        throw new AuthError(
          status === 401 || status === 404
            ? 'INVALID_CREDENTIALS'
            : 'LOGIN_FAILED',
          status,
        );
      return parseAuthResult(json);
    },
    async signup(
      username: string,
      authId: string,
      password: string,
    ): Promise<void> {
      const { status, ok } = await post('/v1/auth/signup', {
        username,
        auth_id: authId,
        encrypted_password: sha256(encryptedPassword(authId, password)),
      });
      if (!ok)
        throw new AuthError(
          status === 409 ? 'ID_TAKEN' : 'SIGNUP_FAILED',
          status,
        );
    },
    // Google ID token from the Android sign-in SDK; the server checks issuer and audience.
    async google(idToken: string): Promise<AuthResult | GoogleLinkRequired> {
      const { status, ok, json } = await post('/v1/google_auth/signup_mobile', {
        google_access_token: idToken,
      });
      if (!ok)
        throw new AuthError(
          status === 401 ? 'GOOGLE_TOKEN_REJECTED' : 'GOOGLE_LOGIN_FAILED',
          status,
        );
      if (typeof json?.linkToken === 'string' && json.linkToken && !json.auth) {
        if (json.linkToken.length > 8192)
          throw new AuthError('INVALID_AUTH_RESPONSE');
        return { linkToken: json.linkToken };
      }
      return parseAuthResult(json);
    },
    // Links the Google identity in linkToken to an existing account (authId + its
    // password) or, with a username for a new authId, creates the account (desktop flow).
    async googleLink({
      linkToken,
      authId,
      password,
      username,
    }: {
      linkToken: string;
      authId: string;
      password: string;
      username?: string;
    }): Promise<void> {
      const { status, ok } = await post('/v1/google_auth/signup', {
        ...(username ? { username } : {}),
        auth_id: authId,
        encrypted_password: sha256(encryptedPassword(authId, password)),
        google_link_token: linkToken,
      });
      if (!ok) {
        const code =
          status === 401
            ? 'INVALID_CREDENTIALS_OR_LINK_EXPIRED'
            : status === 409
            ? 'GOOGLE_ALREADY_LINKED'
            : 'GOOGLE_LINK_FAILED';
        throw new AuthError(code, status);
      }
    },
    async refresh(tokens: AuthTokens): Promise<AuthTokens> {
      const { ok, json } = await post('/v1/auth/refreshToken', null, {
        Authorization: 'Bearer ' + tokens.accessToken,
        'X-Refresh-Token': tokens.refreshToken,
      });
      if (!ok) throw new AuthError('UNAUTHORIZED');
      return {
        accessToken: token(json?.access_token),
        refreshToken: token(json?.refresh_token),
      };
    },
  };
}

export type AuthApi = ReturnType<typeof createAuthApi>;
