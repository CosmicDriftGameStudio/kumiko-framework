// Envelope encryption primitives. Combines a freshly-generated DEK + the
// central KEK (via MasterKeyProvider) into a self-contained Envelope that
// carries everything needed to decrypt later.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Envelope, KeyScope, MasterKeyProvider } from "./types";

const ALGORITHM = "aes-256-gcm";
const DEK_LENGTH = 32; // AES-256
const IV_LENGTH = 12; // GCM standard nonce length

// Encrypts plaintext with a new random DEK, then wraps the DEK with the
// current KEK. The returned Envelope is safe to store at rest.
export async function encryptValue(
  plaintext: string,
  provider: MasterKeyProvider,
  scope?: KeyScope,
): Promise<Envelope> {
  // Fresh DEK per value. Reusing DEKs across rows would break forward
  // secrecy (one compromised ciphertext-IV pair leaks information about
  // others encrypted with the same DEK).
  const dek = randomBytes(DEK_LENGTH);
  try {
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const { encryptedDek, kekVersion } = await provider.wrapDek(dek, scope);
    return { ciphertext, iv, authTag, encryptedDek, kekVersion };
  } finally {
    // Zero the DEK on best effort regardless of success — if provider.wrapDek
    // threw, the plaintext DEK must still not linger in the heap waiting
    // for GC. Node can't guarantee secure erase, but clearing the bytes
    // removes the obvious window.
    dek.fill(0);
  }
}

// Decrypts an Envelope. Throws if the authTag doesn't match — tampered
// ciphertexts cannot round-trip.
export async function decryptValue(
  envelope: Envelope,
  provider: MasterKeyProvider,
  scope?: KeyScope,
): Promise<string> {
  const dek = await provider.unwrapDek(envelope.encryptedDek, envelope.kekVersion, scope);
  try {
    const decipher = createDecipheriv(ALGORITHM, dek, envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } finally {
    dek.fill(0);
  }
}
