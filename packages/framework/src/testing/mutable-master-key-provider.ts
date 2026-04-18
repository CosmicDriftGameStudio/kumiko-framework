// Test utility: a MasterKeyProvider wrapper whose backing provider can be
// swapped mid-test. Use-case: simulating KEK-rotation ("ops flipped
// CURRENT=2") without rebuilding the whole stack + SecretsContext.
//
// Prod analogue: ENV swap + process restart. This helper is purely for
// tests that want to exercise pre- and post-rotation behaviour in a
// single suite.

import type { MasterKeyProvider } from "../secrets";

export type MutableMasterKeyProvider = MasterKeyProvider & {
  // Replace the backing provider. All future wrapDek/unwrapDek/currentVersion
  // calls delegate to `next`. Existing in-flight calls already hold a
  // reference to the old provider's closure and finish under its contract.
  replace(next: MasterKeyProvider): void;
};

export function createMutableMasterKeyProvider(
  initial: MasterKeyProvider,
): MutableMasterKeyProvider {
  let current = initial;
  return {
    wrapDek: (dek) => current.wrapDek(dek),
    unwrapDek: (e, v) => current.unwrapDek(e, v),
    currentVersion: () => current.currentVersion(),
    isAvailable: () => current.isAvailable(),
    replace: (next) => {
      current = next;
    },
  };
}
