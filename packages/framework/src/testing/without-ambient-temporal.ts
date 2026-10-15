/**
 * Run `fn` with `globalThis.Temporal` deleted, then restore.
 * Used by ambient-independence regression tests (kumiko-framework#1525/#1550).
 */
export async function withoutAmbientTemporal<T>(fn: () => T | Promise<T>): Promise<T> {
  const savedGlobal: unknown = Reflect.get(globalThis, "Temporal");
  Reflect.deleteProperty(globalThis, "Temporal");
  try {
    return await fn();
  } finally {
    if (savedGlobal === undefined) Reflect.deleteProperty(globalThis, "Temporal");
    else Reflect.set(globalThis, "Temporal", savedGlobal);
  }
}
