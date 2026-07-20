// String-in/string-out envelope encryption for TEXT-column stores (config
// values, entity fields). The stored string is JSON of StoredEnvelope; the
// kekVersion inside makes every value rotatable via the MasterKeyProvider
// keyring.

import { InternalError } from "../errors/classes";
import type { DekCache } from "./dek-cache";
import { createDekCache, withDekCache } from "./dek-cache";
import { decryptValue, encryptValue } from "./envelope";
import { decodeStoredEnvelope, encodeStoredEnvelope, isStoredEnvelope } from "./stored-envelope";
import type { KeyScope, MasterKeyProvider } from "./types";

export type EnvelopeCipherOptions = {
  // Shared DEK cache — pass the app-wide instance so config/entity reads
  // amortise KEK unwraps together with ctx.secrets.
  readonly dekCache?: DekCache;
};

export type EnvelopeCipher = {
  encrypt(plaintext: string, scope?: KeyScope): Promise<string>;
  decrypt(stored: string, scope?: KeyScope): Promise<string>;
};

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
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored);
      } catch {
        throw new InternalError({
          message: "[envelope-cipher] stored value is not valid JSON",
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
    },
  };
}
