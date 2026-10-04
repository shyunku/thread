import {
  DEFAULT_SERVER_ENDPOINT,
  normalizeEndpoint,
  readConfig,
} from '@/core/config';
import { createLogger } from '@/core/log';

test('endpoint accepts http(s) origins only and falls back to production', () => {
  expect(normalizeEndpoint('http://10.0.2.2:4033/')).toBe(
    'http://10.0.2.2:4033',
  );
  expect(normalizeEndpoint('https://api.threadapp.kr/v3')).toBe(
    'https://api.threadapp.kr',
  );
  expect(normalizeEndpoint(undefined)).toBe(DEFAULT_SERVER_ENDPOINT);
  expect(normalizeEndpoint('ftp://example.com')).toBe(DEFAULT_SERVER_ENDPOINT);
  expect(normalizeEndpoint('https://user:pw@example.com')).toBe(
    DEFAULT_SERVER_ENDPOINT,
  );
  expect(normalizeEndpoint('not a url')).toBe(DEFAULT_SERVER_ENDPOINT);
});

test('release builds never log; development logs unless secure mode is on', () => {
  expect(readConfig({ dev: false }).secureLogs).toBe(true);
  expect(readConfig({ dev: true }).secureLogs).toBe(false);
  expect(readConfig({ dev: true, SECURE_LOGS: '1' }).secureLogs).toBe(true);
  expect(
    readConfig({
      dev: true,
      GOOGLE_OAUTH_WEB_CLIENT_ID: 'replace-with-google-web-client-id',
    }).googleWebClientId,
  ).toBeNull();
});

test('secure logger writes nothing', () => {
  const sink = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  createLogger(true, sink).error('boom');
  expect(sink.error).not.toHaveBeenCalled();
  createLogger(false, sink).info('hello');
  expect(sink.info).toHaveBeenCalledWith('[thread]', 'hello');
});
