// Resolves a caller-named set of secret slots from a Key Manager ciphertext
// when no plaintext is set, so they need not sit in the pod env in the clear.
// A slot's plaintext always wins over its ciphertext sibling, with no request
// made at all. Any `*_CIPHERTEXT` in the env that names no requested slot is
// ignored — a foreign ciphertext must never fail boot.

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
  readonly KUMIKO_BLIND_INDEX_KEY?: string | undefined;
  readonly KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT?: string | undefined;
  readonly [key: string]: string | undefined;
};

export type KekSourceOptions = {
  readonly fetch?: typeof globalThis.fetch;
  readonly logPrefix?: string;
  /** Where the boot line naming the KEK source goes. Defaults to `console.info`. */
  readonly log?: (message: string) => void;
  /** Env names to resolve, e.g. `kmsSlotsOf(schema)`. */
  readonly slots: readonly string[];
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
    } catch (error) {
      if (attempt < maxAttempts) {
        await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 0);
        continue;
      }
      throw new Error(
        `${prefix}Key Manager decrypt failed for key ${keyId}: network error or timeout`,
        { cause: error },
      );
    }

    if (!response.ok) {
      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        await response.body?.cancel();
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

type ResolvedSlot = {
  readonly value: string | undefined;
  // Never carries a key value, only its origin.
  readonly sourceLine: string | undefined;
};

// A leftover plaintext beside a ciphertext boots green while nothing was
// migrated, which is indistinguishable from a finished cutover unless the
// boot says which source won. The line is built from the path actually taken.
async function resolveSlot(
  name: string,
  env: KekSourceEnv,
  options: KekSourceOptions,
  fetchImpl: typeof globalThis.fetch,
): Promise<ResolvedSlot> {
  const plaintext = env[name];
  const ciphertext = env[`${name}_CIPHERTEXT`];
  if (plaintext) {
    return {
      value: plaintext,
      sourceLine: ciphertext
        ? `${name} source=plaintext-env (ciphertext present and ignored)`
        : `${name} source=plaintext-env`,
    };
  }
  if (!ciphertext) return { value: undefined, sourceLine: undefined };

  const keyId = env.PLATFORM_KEK_KMS_KEY_ID;
  const token = env.PLATFORM_KEK_KMS_TOKEN;
  if (!keyId || !token) {
    const prefix = options.logPrefix ? `${options.logPrefix} ` : "";
    throw new Error(
      `${prefix}${name}_CIPHERTEXT is set but PLATFORM_KEK_KMS_KEY_ID / PLATFORM_KEK_KMS_TOKEN are missing — a partial set means the KMS wiring is broken.`,
    );
  }
  const region = env.PLATFORM_KEK_KMS_REGION ?? DEFAULT_REGION;
  const value = await decryptCiphertext(
    ciphertext,
    keyId,
    token,
    region,
    fetchImpl,
    options.logPrefix,
  );
  return {
    value,
    sourceLine: `${name} source=key-manager keyId=${keyId} region=${region}`,
  };
}

// Each slot resolves independently so a rollback that clears one slot's
// plaintext (leaving its ciphertext/_VERSION behind or gone) never blocks
// another slot's fallback path — the trio check downstream still applies.
// Slots resolve in parallel: sequentially, a slow Key Manager would cost up to
// ~16 s per slot (3 x 5 s timeout + backoff) and could trip startup probes.
export async function resolvePlatformKeks(
  env: KekSourceEnv,
  options: KekSourceOptions,
): Promise<KekSourceEnv> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const prefix = options.logPrefix ? `${options.logPrefix} ` : "";

  const { slots } = options;
  // Misconfiguration must not cost a Key Manager round trip.
  if (
    slots.includes("PLATFORM_KEK_PREVIOUS") &&
    (env.PLATFORM_KEK_PREVIOUS || env.PLATFORM_KEK_PREVIOUS_CIPHERTEXT) &&
    !env.PLATFORM_KEK_PREVIOUS_VERSION
  ) {
    throw new Error(
      `${prefix}PLATFORM_KEK_PREVIOUS_VERSION must be set when PLATFORM_KEK_PREVIOUS is set.`,
    );
  }

  const results = await Promise.all(
    slots.map((name) => resolveSlot(name, env, options, fetchImpl)),
  );

  // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
  const log = options.log ?? console.info;
  const resolved: Record<string, string | undefined> = {};
  slots.forEach((name, index) => {
    const result = results[index];
    // skip: slot without a resolved result stays unset
    if (!result) return;
    resolved[name] = result.value;
    if (result.sourceLine) log(`${prefix}${result.sourceLine}`);
  });

  const changed = Object.keys(resolved).some((name) => resolved[name] !== env[name]);
  if (!changed) return env;

  return { ...env, ...resolved };
}
