// Globals the shared E2EE code and cborg expect but Hermes may not provide.
// Loaded first from index.js, before anything that reads them at import time.
import { Buffer } from 'buffer';

const g = globalThis as any;

g.Buffer = g.Buffer || Buffer;

if (typeof g.TextDecoder === 'undefined') {
  // UTF-8 only, replacing invalid sequences like the standard non-fatal decoder.
  g.TextDecoder = class TextDecoder {
    readonly encoding = 'utf-8';
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return '';
      const bytes = ArrayBuffer.isView(input)
        ? Buffer.from(
            input.buffer as ArrayBuffer,
            input.byteOffset,
            input.byteLength,
          )
        : Buffer.from(input);
      return bytes.toString('utf8');
    }
  };
}

if (typeof g.TextEncoder === 'undefined') {
  g.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      const bytes = Buffer.from(input, 'utf8');
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
  };
}
