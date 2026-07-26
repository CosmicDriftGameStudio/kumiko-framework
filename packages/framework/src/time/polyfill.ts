// Temporal polyfill bootstrap.
//
// Temporal is native in Chromium 144+ / Firefox 139+, but missing in Safari,
// iOS, and Hermes. Bun/Node coverage is incomplete. Boot installs
// `temporal-polyfill` once so server/web/mobile share one API.
//
// Idempotent: if `globalThis.Temporal` already exists the call is a no-op.
// The cache is the live global check — not a sticky module flag — so tests
// that delete the ambient global (fw#1550) still re-install on the next call.
// Re-install uses the value export + Object.assign (not `temporal-polyfill/global`
// side-effect import): ESM caches the side-effect module and would not re-run
// after a teardown.

let polyfillPromise: Promise<void> | null = null;

/**
 * Ensure `globalThis.Temporal` is available. Idempotent.
 */
export async function ensureTemporalPolyfill(): Promise<void> {
  if ("Temporal" in globalThis) {
    // skip: Temporal already on globalThis (native or prior polyfill)
    return;
  }
  if (polyfillPromise) {
    await polyfillPromise;
    if ("Temporal" in globalThis) {
      // skip: Concurrent boot — peer call finished install
      return;
    }
    // Peer resolved but global still missing (torn down mid-flight).
    polyfillPromise = null;
  }

  polyfillPromise = (async () => {
    if ("Temporal" in globalThis) {
      // skip: raced native/peer install
      return;
    }
    // Value export — assign ourselves so teardown + re-call still works
    // (side-effect `temporal-polyfill/global` is ESM-cached and silent on re-import).
    const { Temporal } = await import("temporal-polyfill");
    Object.assign(globalThis, { Temporal });
  })();

  await polyfillPromise;
}

/**
 * Type-safe access to globalThis.Temporal. Throws if the polyfill has not
 * been installed yet (boot-order bug).
 */
export function getTemporal(): typeof Temporal {
  if (!("Temporal" in globalThis)) {
    throw new Error(
      "Temporal not available. Call ensureTemporalPolyfill() during framework boot before any time-related code runs.",
    );
  }
  return Temporal;
}
