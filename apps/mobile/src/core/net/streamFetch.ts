import { Buffer } from 'buffer';
import type { FetchLike } from './fetch';

// Streaming GET for the server's change signals (/v3/sync/events, text/event-stream).
// React Native's fetch cannot stream, but its XMLHttpRequest grows `responseText`
// while the response arrives; this turns that into the reader the shared
// syncEvents client expects.
export function createStreamFetch(
  XHR: any = (globalThis as any).XMLHttpRequest,
): FetchLike {
  return (url, init: any = {}) =>
    new Promise((resolve, reject) => {
      const xhr = new XHR();
      let seen = 0;
      let ended = false;
      let failed: Error | null = null;
      let wake: (() => void) | null = null;
      const notify = () => {
        const next = wake;
        wake = null;
        next?.();
      };
      const abort = () => {
        failed = Error('ABORTED');
        xhr.abort();
        notify();
      };
      init.signal?.addEventListener?.('abort', abort, { once: true });
      xhr.open(init.method ?? 'GET', url);
      xhr.responseType = 'text';
      for (const [name, value] of Object.entries(init.headers ?? {}))
        xhr.setRequestHeader(name, String(value));
      let settled = false;
      const respond = () => {
        if (settled) return;
        settled = true;
        resolve({
          status: xhr.status,
          ok: xhr.status >= 200 && xhr.status < 300,
          body: {
            cancel: async () => abort(),
            getReader() {
              return {
                async read(): Promise<{ done: boolean; value?: Uint8Array }> {
                  for (;;) {
                    const text: string = xhr.responseText ?? '';
                    if (text.length > seen) {
                      const value = Buffer.from(text.slice(seen), 'utf8');
                      seen = text.length;
                      return { done: false, value };
                    }
                    if (failed || ended) return { done: true };
                    await new Promise<void>(resume => (wake = resume));
                  }
                },
                cancel: async () => abort(),
              };
            },
          },
        });
      };
      xhr.onreadystatechange = () => {
        if (xhr.readyState >= 2) respond(); // headers received
        if (xhr.readyState === 4) ended = true;
        notify();
      };
      xhr.onprogress = notify;
      xhr.onerror = () => {
        failed = Error('NETWORK_UNAVAILABLE');
        if (!settled) reject(failed);
        notify();
      };
      xhr.send();
    });
}
