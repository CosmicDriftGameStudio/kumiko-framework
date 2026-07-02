// Test utility: a MasterKeyProvider wrapper whose backing provider can be
// swapped mid-test. Use-case: simulating KEK-rotation ("ops flipped
// CURRENT=2") without rebuilding the whole stack + SecretsContext.
//
// Prod analogue: ENV swap + process restart. This helper is purely for
// tests that want to exercise pre- and post-rotation behaviour in a
// single suite.

import { randomBytes } from "node:crypto";
import {
  createEnvelopeCipher,
  createEnvMasterKeyProvider,
  type EnvelopeCipher,
  type EnvelopeCipherOptions,
  type MasterKeyProvider,
} from "../secrets";

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
    wrapDek: (dek, scope) => current.wrapDek(dek, scope),
    unwrapDek: (e, v, scope) => current.unwrapDek(e, v, scope),
    currentVersion: () => current.currentVersion(),
    isAvailable: () => current.isAvailable(),
    replace: (next) => {
      current = next;
    },
  };
}

// Single-version env provider for tests — the shape every integration test
// needs to exercise encrypted config keys / entity fields without caring
// about keyring mechanics. Pass a fixed key to share it across stacks.
export function createTestMasterKeyProvider(keyBase64?: string): MasterKeyProvider {
  return createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      KUMIKO_SECRETS_MASTER_KEY_V1: keyBase64 ?? randomBytes(32).toString("base64"),
    },
  });
}

export function createTestEnvelopeCipher(
  keyBase64?: string,
  opts?: EnvelopeCipherOptions,
): EnvelopeCipher {
  return createEnvelopeCipher(createTestMasterKeyProvider(keyBase64), opts ?? {});
}
