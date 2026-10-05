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

test('diagnostic test builds log only errors, reduced to type, code and location', () => {
  expect(readConfig({ dev: false }).diagnosticLogs).toBe(false);
  expect(readConfig({ dev: false, DIAGNOSTIC_LOGS: '1' }).diagnosticLogs).toBe(
    true,
  );
  const sink = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const log = createLogger(true, sink, true);
  log.info('task title: buy milk');
  log.warn('token abc');
  expect(sink.info).not.toHaveBeenCalled();
  expect(sink.warn).not.toHaveBeenCalled();

  const coded = Object.assign(Error('VAULT_LOCKED'), { code: 'VAULT_LOCKED' });
  const engine = new TypeError('undefined is not a function');
  const leaky = Error('could not parse "buy milk at 6pm"');
  log.error('SHOWN_ERROR', coded, engine, leaky, 'free text with secret');
  const written = sink.error.mock.calls[0].join(' ');
  expect(written).toContain('SHOWN_ERROR');
  expect(written).toContain('Error VAULT_LOCKED: VAULT_LOCKED');
  expect(written).toContain('TypeError: undefined is not a function');
  expect(written).not.toContain('buy milk');
  expect(written).not.toContain('secret');
  expect(written).toContain('[string]');
});
