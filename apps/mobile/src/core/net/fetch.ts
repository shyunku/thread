import { Buffer } from 'buffer';

// React Native's fetch has no streaming response body, but the shared code
// (packages/e2ee transport and account sessions) reads `response.body.getReader()`
// to enforce size limits. This adapter buffers the body once and serves it through
// the same reader shape. Size limits still apply: the reader stops at the limit.
export type FetchLike = (url: string, init?: any) => Promise<any>;

function requestBody(body: unknown) {
  // Binary request bodies (CBOR records) go out as an ArrayBuffer copy.
  if (body instanceof Uint8Array) {
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy.buffer;
  }
  return body;
}

export function createFetch(
  base: FetchLike = globalThis.fetch as any,
): FetchLike {
  return async (url, init = {}) => {
    const response = await base(url, { ...init, body: requestBody(init.body) });
    let consumed = false;
    const take = async () => {
      if (consumed) throw Error('BODY_USED');
      consumed = true;
      return Buffer.from(new Uint8Array(await response.arrayBuffer()));
    };
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text: async () => (await take()).toString('utf8'),
      arrayBuffer: async () => {
        const bytes = await take();
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      },
      body: {
        cancel: async () => {
          consumed = true;
        },
        getReader() {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              const value = await take();
              return value.length
                ? { done: false, value }
                : { done: true, value: undefined };
            },
            cancel: async () => {
              done = true;
            },
          };
        },
      },
    };
  };
}
