/// <reference types="temporal-polyfill/global" preserve="true" />
// Temporal bootstrap.
//
// Temporal is native in Bun >= 1.4 and current Chromium/Firefox, but missing in
// Safari, iOS and Hermes. `@cosmicdrift/kumiko-types/temporal` resolves one
// implementation (native first, polyfill otherwise) so framework, consumer and
// ambient-global code all see the same classes.
//
// Idempotent: if `globalThis.Temporal` already exists the call is a no-op.
// The check is the live global — not a sticky module flag — so tests that
// delete the ambient global (fw#1550) still get it back on the next call.
// Re-install assigns the already-resolved module value: re-importing
// `temporal-polyfill` here would put a polyfill instance on the global while
// the rest of the code uses the native classes (instanceof mismatch).

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

/**
 * Ensure `globalThis.Temporal` is available. Idempotent.
 */
export async function ensureTemporalPolyfill(): Promise<void> {
  // skip: Temporal global already present (native or installed by an earlier call)
  if ("Temporal" in globalThis) return;
  Object.assign(globalThis, { Temporal });
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
