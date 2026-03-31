import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EncryptionProvider = {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
};

export function createEncryptionProvider(key: string): EncryptionProvider {
  // Key must be 32 bytes for AES-256
  const keyBuffer = Buffer.from(key, "base64");
  if (keyBuffer.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (base64 encoded)");
  }

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Format: base64(iv + tag + ciphertext)
      return Buffer.concat([iv, tag, encrypted]).toString("base64");
    },

    decrypt(ciphertext: string): string {
      const data = Buffer.from(ciphertext, "base64");
      const iv = data.subarray(0, IV_LENGTH);
      const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted) + decipher.final("utf8");
    },
  };
}
