// One place that turns env/options into the app-wide crypto objects:
// the MasterKeyProvider (KUMIKO_SECRETS_MASTER_KEY_V<n> keyring) and the
// EnvelopeCipher for `encrypted: true` config keys. runProdApp and
// runDevApp both resolve this once and thread it into
// buildBootExtraContext + applyBootSeeds so resolver, set-handler and
// seeds share the same cipher instance (and DEK cache).

import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import {
  createDekCache,
  createEnvelopeCipher,
  createEnvMasterKeyProvider,
  type DekCache,
  type EnvelopeCipher,
  type MasterKeyProvider,
} from "@cosmicdrift/kumiko-framework/secrets";

// Keyring detection without throwing: only build the env provider when at
// least one versioned KEK is actually set. Covers (a) apps without any
// encryption — no KEK requirement, and (b) dev with an app-supplied
// provider in options.masterKey — env stays irrelevant.
const MASTER_KEK_VAR = /^KUMIKO_SECRETS_MASTER_KEY_V\d+$/;
export function envHasMasterKek(env: Record<string, string | undefined>): boolean {
  return Object.entries(env).some(([k, v]) => MASTER_KEK_VAR.test(k) && !!v);
}

export type BootCrypto = {
  readonly masterKeyProvider?: MasterKeyProvider;
  // Cipher for encrypted config keys. Present exactly when a master key is
  // available. Decrypts legacy CONFIG_ENCRYPTION_KEY values as fallback
  // until the config re-encrypt job migrated them.
  readonly configCipher?: EnvelopeCipher;
  // Cipher for `encrypted: true` entity fields — same master key, but the
  // legacy fallback reads the pre-envelope ENCRYPTION_KEY format. Identical
  // to configCipher when no ENCRYPTION_KEY is set.
  readonly entityFieldCipher?: EnvelopeCipher;
  readonly dekCache: DekCache;
};

export function resolveBootCrypto(
  envSource: Record<string, string | undefined>,
  masterKeyOverride?: MasterKeyProvider,
): BootCrypto {
  const masterKeyProvider =
    masterKeyOverride ??
    (envHasMasterKek(envSource)
      ? createEnvMasterKeyProvider({
          // CURRENT_VERSION default "1" spiegelt secretsEnvSchema — ohne
          // ihn wirft der raw-env-Provider, obwohl V1 gesetzt ist.
          env: {
            ...envSource,
            KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION:
              envSource["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] ?? "1",
          },
        })
      : undefined);

  const dekCache = createDekCache();
  const legacyConfigKey = envSource["CONFIG_ENCRYPTION_KEY"];
  const configCipher = masterKeyProvider
    ? createEnvelopeCipher(masterKeyProvider, {
        dekCache,
        ...(legacyConfigKey ? { legacy: createEncryptionProvider(legacyConfigKey) } : {}),
      })
    : undefined;

  const legacyEntityKey = envSource["ENCRYPTION_KEY"];
  const entityFieldCipher =
    masterKeyProvider && legacyEntityKey
      ? createEnvelopeCipher(masterKeyProvider, {
          dekCache,
          legacy: createEncryptionProvider(legacyEntityKey),
        })
      : configCipher;

  return {
    ...(masterKeyProvider && { masterKeyProvider }),
    ...(configCipher && { configCipher }),
    ...(entityFieldCipher && { entityFieldCipher }),
    dekCache,
  };
}
