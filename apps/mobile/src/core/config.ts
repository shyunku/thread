import {
  APP_SERVER_ENDPOINT,
  GOOGLE_OAUTH_WEB_CLIENT_ID,
  SECURE_LOGS,
} from '@env';

export const DEFAULT_SERVER_ENDPOINT = 'https://api.threadapp.kr';

export type AppConfig = {
  serverEndpoint: string;
  googleWebClientId: string | null;
  secureLogs: boolean;
};

// Only http(s) origins without credentials are accepted; anything else falls back.
export function normalizeEndpoint(value: string | undefined): string {
  if (!value) return DEFAULT_SERVER_ENDPOINT;
  try {
    const url = new URL(value.trim());
    if (
      (url.protocol !== 'https:' && url.protocol !== 'http:') ||
      url.username ||
      url.password
    ) {
      return DEFAULT_SERVER_ENDPOINT;
    }
    return url.origin;
  } catch {
    return DEFAULT_SERVER_ENDPOINT;
  }
}

export function readConfig(env: {
  APP_SERVER_ENDPOINT?: string;
  GOOGLE_OAUTH_WEB_CLIENT_ID?: string;
  SECURE_LOGS?: string;
  dev: boolean;
}): AppConfig {
  const clientId = env.GOOGLE_OAUTH_WEB_CLIENT_ID?.trim();
  return {
    serverEndpoint: normalizeEndpoint(env.APP_SERVER_ENDPOINT),
    googleWebClientId:
      clientId && !clientId.startsWith('replace-') ? clientId : null,
    // Release builds never log; development logs unless secure mode is on.
    secureLogs: !env.dev || env.SECURE_LOGS === '1',
  };
}

export const config = readConfig({
  APP_SERVER_ENDPOINT,
  GOOGLE_OAUTH_WEB_CLIENT_ID,
  SECURE_LOGS,
  dev: __DEV__,
});
