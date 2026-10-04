import { config } from './config';

type Level = 'debug' | 'info' | 'warn' | 'error';

// Same rule as the desktop secure mode: when on, the app writes no logs at all.
// Never pass plaintext task data, keys or tokens here even when logging is on.
export function createLogger(
  secure: boolean,
  sink: Pick<Console, Level> = console,
) {
  const write =
    (level: Level) =>
    (...args: unknown[]) => {
      if (!secure) sink[level]('[thread]', ...args);
    };
  return {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
}

export const log = createLogger(config.secureLogs);
