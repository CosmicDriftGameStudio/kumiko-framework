// KEK rotation: unwrap the DEK with the OLD kekVersion, re-wrap with the
// CURRENT one. The ciphertext never changes — this is why envelope
// encryption makes rotation affordable on large tables.

import type { Envelope, MasterKeyProvider } from "./types";

// Re-wrap the DEK of a single envelope so it references the current KEK
// version. No-op when the envelope is already current (caller-side this
// means "filter WHERE kekVersion != currentVersion" before calling).
export async function rewrapDek(
  envelope: Envelope,
  provider: MasterKeyProvider,
): Promise<Envelope> {
  if (envelope.kekVersion === provider.currentVersion()) {
    return envelope;
  }
  // Unwrap with the old KEK. Provider must still know the old version
  // (keyring contains both until ops retires the old KEK).
  const dek = await provider.unwrapDek(envelope.encryptedDek, envelope.kekVersion);
  try {
    const { encryptedDek, kekVersion } = await provider.wrapDek(dek);
    return {
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      encryptedDek,
      kekVersion,
    };
  } finally {
    // Zero the unwrapped DEK — it was held in plaintext only long enough
    // to wrap it again.
    dek.fill(0);
  }
}
