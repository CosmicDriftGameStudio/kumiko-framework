// String-in/string-out envelope encryption for TEXT-column stores (config
// values, entity fields). The stored string is JSON of StoredEnvelope; the
// kekVersion inside makes every value rotatable via the MasterKeyProvider
// keyring — unlike the legacy createEncryptionProvider format (raw
// base64(iv+tag+ct), no key id), which this cipher still DECRYPTS through
// the optional legacy provider so pre-envelope rows stay readable until a
// re-encrypt job has migrated them.

import type { EncryptionProvider } from "../db/encryption";
import { InternalError } from "../errors/classes";
import { createDekCache, withDekCache } from "./dek-cache";
import type { DekCache } from "./dek-cache";
import { decryptValue, encryptValue } from "./envelope";
import { decodeStoredEnvelope, encodeStoredEnvelope, isStoredEnvelope } from "./stored-envelope";
import type { KeyScope, MasterKeyProvider } from "./types";

export type EnvelopeCipherOptions = {
  // Decrypt-only fallback for legacy createEncryptionProvider ciphertexts
  // (CONFIG_ENCRYPTION_KEY / ENCRYPTION_KEY era). Never used for encrypt.
  readonly legacy?: EncryptionProvider;
  // Shared DEK cache — pass the app-wide instance so config/entity reads
  // amortise KEK unwraps together with ctx.secrets.
  readonly dekCache?: DekCache;
};

export type EnvelopeCipher = {
  encrypt(plaintext: string, scope?: KeyScope): Promise<string>;
  decrypt(stored: string, scope?: KeyScope): Promise<string>;
};

// Format detection: envelope values are JSON objects, so they start with
// "{" — a character the base64 alphabet of the legacy format can never
// produce. No version byte or prefix marker needed.
function isEnvelopeFormat(stored: string): boolean {
  return stored.startsWith("{");
}

export function createEnvelopeCipher(
  provider: MasterKeyProvider,
  opts: EnvelopeCipherOptions = {},
): EnvelopeCipher {
  const cached = withDekCache(provider, opts.dekCache ?? createDekCache());

  return {
    async encrypt(plaintext, scope) {
      const envelope = await encryptValue(plaintext, provider, scope);
      return JSON.stringify(encodeStoredEnvelope(envelope));
    },

    async decrypt(stored, scope) {
      if (isEnvelopeFormat(stored)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(stored);
        } catch {
          throw new InternalError({
            message: "[envelope-cipher] stored value looks like an envelope but is not valid JSON",
            i18nKey: "secrets.errors.envelope_malformed",
          });
        }
        if (!isStoredEnvelope(parsed)) {
          throw new InternalError({
            message: "[envelope-cipher] stored JSON is not a StoredEnvelope",
            i18nKey: "secrets.errors.envelope_malformed",
          });
        }
        return decryptValue(decodeStoredEnvelope(parsed), cached, scope);
      }

      if (!opts.legacy) {
        throw new InternalError({
          message:
            "[envelope-cipher] value is in the legacy single-key format but no legacy key is configured — " +
            "provision the legacy key (CONFIG_ENCRYPTION_KEY / ENCRYPTION_KEY) or run the re-encrypt job first",
          i18nKey: "secrets.errors.legacy_key_missing",
        });
      }
      return opts.legacy.decrypt(stored);
    },
  };
}
