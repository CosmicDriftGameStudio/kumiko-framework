// Resolves PLATFORM_KEK / PLATFORM_KEK_PREVIOUS from a Key Manager ciphertext
// when no plaintext is set, so the KEK need not sit in the pod env in the
// clear. `PLATFORM_KEK` stays the source of truth: a plaintext value always
// wins over its ciphertext sibling, with no request made at all.

const SCALEWAY_KEY_MANAGER_API_VERSION = "v1alpha1";
const DEFAULT_REGION = "fr-par";
const DECRYPT_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [200, 800];

export type KekSourceEnv = {
  readonly PLATFORM_KEK?: string | undefined;
  readonly PLATFORM_KEK_CIPHERTEXT?: string | undefined;
  readonly PLATFORM_KEK_PREVIOUS?: string | undefined;
  readonly PLATFORM_KEK_PREVIOUS_CIPHERTEXT?: string | undefined;
  readonly PLATFORM_KEK_PREVIOUS_VERSION?: string | undefined;
  readonly PLATFORM_KEK_KMS_KEY_ID?: string | undefined;
  readonly PLATFORM_KEK_KMS_TOKEN?: string | undefined;
  readonly PLATFORM_KEK_KMS_REGION?: string | undefined;
  readonly [key: string]: string | undefined;
};

export type KekSourceOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly logPrefix?: string;
};

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Scaleway's decrypt SLA is 99.5% — a bootpath that gives up on the first
// transient 5xx or timeout trades a rare retry for a routine boot failure.
// 4xx means the request itself is wrong (bad token, bad key id) and no
// amount of retrying fixes that, so it fails fast instead of stalling boot.
async function decryptCiphertext(
  ciphertext: string,
  keyId: string,
  token: string,
  region: string,
  fetchImpl: typeof globalThis.fetch,
  logPrefix: string | undefined,
): Promise<string> {
  const url = `https://api.scaleway.com/key-manager/${SCALEWAY_KEY_MANAGER_API_VERSION}/regions/${region}/keys/${keyId}/decrypt`;
  const prefix = logPrefix ? `${logPrefix} ` : "";
  const maxAttempts = RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "X-Auth-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ ciphertext }),
        signal: AbortSignal.timeout(DECRYPT_TIMEOUT_MS),
      });
    } catch {
      if (attempt < maxAttempts) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 0);
        continue;
      }
      throw new Error(
        `${prefix}Key Manager decrypt failed for key ${keyId}: network error or timeout`,
      );
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 0);
        continue;
      }
      throw new Error(
        `${prefix}Key Manager decrypt failed for key ${keyId}: HTTP ${response.status}`,
      );
    }

    let body: { plaintext?: unknown };
    try {
      body = (await response.json()) as { plaintext?: unknown };
    } catch {
      throw new Error(
        `${prefix}Key Manager decrypt for key ${keyId} returned an unparseable response`,
      );
    }
    if (typeof body.plaintext !== "string") {
      throw new Error(`${prefix}Key Manager decrypt for key ${keyId} returned no plaintext field`);
    }
    return body.plaintext;
  }
  throw new Error(`${prefix}Key Manager decrypt failed for key ${keyId}: retries exhausted`);
}

async function resolveSlot(
  plaintext: string | undefined,
  ciphertext: string | undefined,
  env: KekSourceEnv,
  options: KekSourceOptions,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | undefined> {
  if (plaintext) return plaintext;
  if (!ciphertext) return undefined;

  const keyId = env.PLATFORM_KEK_KMS_KEY_ID;
  const token = env.PLATFORM_KEK_KMS_TOKEN;
  if (!keyId || !token) {
    const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
    throw new Error(
      `${prefix}PLATFORM_KEK_KMS_KEY_ID / PLATFORM_KEK_KMS_TOKEN are all-or-none with a KEK ciphertext — a partial set means the KMS wiring is broken.`,
    );
  }
  const region = env.PLATFORM_KEK_KMS_REGION ?? DEFAULT_REGION;
  return decryptCiphertext(ciphertext, keyId, token, region, fetchImpl, options.logPrefix);
}

// Each slot resolves independently so a rollback that clears one slot's
// plaintext (leaving its ciphertext/_VERSION behind or gone) never blocks the
// other slot's fallback path — the trio check downstream still applies.
export async function resolvePlatformKeks(
  env: KekSourceEnv,
  options: KekSourceOptions = {},
): Promise<KekSourceEnv> {
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const active = await resolveSlot(
    env.PLATFORM_KEK,
    env.PLATFORM_KEK_CIPHERTEXT,
    env,
    options,
    fetchImpl,
  );
  const previous = await resolveSlot(
    env.PLATFORM_KEK_PREVIOUS,
    env.PLATFORM_KEK_PREVIOUS_CIPHERTEXT,
    env,
    options,
    fetchImpl,
  );

  if (previous && !env.PLATFORM_KEK_PREVIOUS_VERSION) {
    const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
    throw new Error(
      `${prefix}PLATFORM_KEK_PREVIOUS_VERSION must be set when PLATFORM_KEK_PREVIOUS is set.`,
    );
  }

  if (active === env.PLATFORM_KEK && previous === env.PLATFORM_KEK_PREVIOUS) {
    return env;
  }
  return { ...env, PLATFORM_KEK: active, PLATFORM_KEK_PREVIOUS: previous };
}
