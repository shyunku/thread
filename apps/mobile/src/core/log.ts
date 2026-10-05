import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

// Error messages that are safe to keep: our own codes (VAULT_LOCKED) and the JS
// engine's own wording. Anything else may carry data and is dropped.
const CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ENGINE_ERRORS = new Set([
  'TypeError',
  'ReferenceError',
  'RangeError',
  'SyntaxError',
]);
const FRAMES = 8;

// What a diagnostic build may write for one value: the error type, its code and
// where it happened in the bundle. Never task text, keys, tokens or request data.
export function diagnostic(value: unknown): string {
  if (value instanceof Error) {
    const code = (value as any).code;
    const message = value.message ?? '';
    const safe =
      CODE.test(message) ||
      (ENGINE_ERRORS.has(value.name) &&
        message.length <= 120 &&
        !/["'`]/.test(message));
    const frames = (value.stack ?? '')
      .split('\n')
      .filter(line => /^\s*at /.test(line))
      .slice(0, FRAMES)
      .map(line => line.trim());
    return [
      `${value.name}${
        typeof code === 'string' && CODE.test(code) ? ` ${code}` : ''
      }${safe ? `: ${message}` : ''}`,
      ...frames,
    ].join('\n  ');
  }
  if (typeof value === 'string' && CODE.test(value)) return value;
  return `[${typeof value}]`;
}

// Same rule as the desktop secure mode: when on, the app writes no logs at all.
// A diagnostic test build (DIAGNOSTIC_LOGS=1, never a store build) keeps only
// errors, reduced to their type, code and code location.
// Never pass plaintext task data, keys or tokens here even when logging is on.
export function createLogger(
  secure: boolean,
  sink: Pick<Console, Level> = console,
  diagnosticErrors = false,
) {
  const write =
    (level: Level) =>
    (...args: unknown[]) => {
      if (!secure) sink[level]('[thread]', ...args);
      else if (diagnosticErrors && level === 'error')
        sink.error('[thread]', ...args.map(diagnostic));
    };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
}

export const log = createLogger(
  config.secureLogs,
  console,
  config.diagnosticLogs,
);

// Uncaught JS errors go through the logger too (then to React Native's handler).
export function installErrorLogging() {
  const ErrorUtils = (globalThis as any).ErrorUtils;
  if (!ErrorUtils?.getGlobalHandler) return;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, fatal?: boolean) => {
    log.error(fatal ? 'FATAL_JS_ERROR' : 'UNCAUGHT_JS_ERROR', error);
    previous(error, fatal);
  });
}
