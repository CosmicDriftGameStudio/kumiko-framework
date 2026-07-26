/**
 * Run `fn` with `globalThis.Temporal` deleted, then restore.
 * Used by ambient-independence regression tests (kumiko-framework#1525/#1550).
 */
export async function withoutAmbientTemporal<T>(fn: () => T | Promise<T>): Promise<T> {
  const savedGlobal = (globalThis as { Temporal?: unknown }).Temporal;
  delete (globalThis as { Temporal?: unknown }).Temporal;
  try {
    return await fn();
  } finally {
    if (savedGlobal === undefined) delete (globalThis as { Temporal?: unknown }).Temporal;
    else (globalThis as { Temporal?: unknown }).Temporal = savedGlobal;
  }
}
