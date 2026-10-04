test('TextDecoder/TextEncoder polyfills round-trip UTF-8 like the standard ones', () => {
  const g = globalThis as any;
  const saved = { TextDecoder: g.TextDecoder, TextEncoder: g.TextEncoder };
  delete g.TextDecoder;
  delete g.TextEncoder;
  try {
    jest.isolateModules(() => require('@/core/polyfills'));
    const bytes = new g.TextEncoder().encode('한글 thread ✓');
    expect(new saved.TextDecoder().decode(bytes)).toBe('한글 thread ✓');
    expect(new g.TextDecoder().decode(bytes.subarray(0, bytes.length))).toBe(
      '한글 thread ✓',
    );
    expect(new g.TextDecoder().decode(new Uint8Array([0xff]))).toBe(
      new saved.TextDecoder().decode(new Uint8Array([0xff])),
    );
  } finally {
    Object.assign(g, saved);
  }
});
