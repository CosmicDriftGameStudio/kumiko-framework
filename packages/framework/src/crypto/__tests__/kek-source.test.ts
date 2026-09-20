import { describe, expect, test } from "bun:test";
import { type KekSourceEnv, resolvePlatformKeks } from "../kek-source";
import { buildPgKmsOptions } from "../kms-wiring";

const TOKEN = "scw-secret-token";
const CIPHERTEXT_A = Buffer.from("ciphertext-a").toString("base64");
const CIPHERTEXT_B = Buffer.from("ciphertext-b").toString("base64");
const PLAINTEXT_A = Buffer.alloc(32, 1).toString("base64");

type FetchCall = { readonly url: string; readonly init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function trackedFetch(responses: ReadonlyArray<Response>): {
  readonly fetch: typeof globalThis.fetch;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const response = responses[index];
    index++;
    if (!response) throw new Error("trackedFetch: no more responses queued");
    return response;
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("resolvePlatformKeks", () => {
  test("passes through unchanged when PLATFORM_KEK is set, without ever calling fetch", async () => {
    const { fetch, calls } = trackedFetch([]);
    const env: KekSourceEnv = { PLATFORM_KEK: PLAINTEXT_A };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result).toBe(env);
    expect(calls.length).toBe(0);
  });

  test("decrypts a lone ciphertext, posting the key id in the path and the token in X-Auth-Token", async () => {
    const { fetch, calls } = trackedFetch([jsonResponse(200, { plaintext: PLAINTEXT_A })]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe(PLAINTEXT_A);
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain("/keys/key-1/decrypt");
    expect(new Headers(calls[0]?.init.headers).get("X-Auth-Token")).toBe(TOKEN);
  });

  test("decrypts both ciphertexts with two distinct requests", async () => {
    const { fetch, calls } = trackedFetch([
      jsonResponse(200, { plaintext: "active-plaintext" }),
      jsonResponse(200, { plaintext: "previous-plaintext" }),
    ]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_PREVIOUS_CIPHERTEXT: CIPHERTEXT_B,
      PLATFORM_KEK_PREVIOUS_VERSION: "1",
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe("active-plaintext");
    expect(result.PLATFORM_KEK_PREVIOUS).toBe("previous-plaintext");
    expect(calls.length).toBe(2);
    const bodies = calls.map((call) => JSON.parse(String(call.init.body)).ciphertext);
    expect(bodies).toEqual([CIPHERTEXT_A, CIPHERTEXT_B]);
  });

  test("throws without the token in the message when a ciphertext has no key id", async () => {
    const { fetch } = trackedFetch([]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    try {
      await resolvePlatformKeks(env, { fetch });
      throw new Error("unreachable");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toMatch(/all-or-none/);
      expect(message).not.toContain(TOKEN);
    }
  });

  test("throws without the token in the message when a ciphertext has no token", async () => {
    const { fetch } = trackedFetch([]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: undefined,
    };

    await expect(resolvePlatformKeks(env, { fetch })).rejects.toThrow(/all-or-none/);
    await expect(resolvePlatformKeks(env, { fetch })).rejects.not.toThrow(new RegExp(TOKEN));
  });

  test("retries a network failure and succeeds on the next attempt", async () => {
    const calls: string[] = [];
    let attempt = 0;
    const fetch = (async (url: string | URL) => {
      calls.push(String(url));
      attempt++;
      if (attempt === 1) throw new TypeError("fetch failed");
      return jsonResponse(200, { plaintext: PLAINTEXT_A });
    }) as typeof globalThis.fetch;
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe(PLAINTEXT_A);
    expect(calls.length).toBe(2);
  });

  test("gives up after the last attempt when every call fails at the network level", async () => {
    const calls: string[] = [];
    const fetch = (async (url: string | URL): Promise<Response> => {
      calls.push(String(url));
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await expect(resolvePlatformKeks(env, { fetch })).rejects.toThrow(/network error or timeout/);
    expect(calls.length).toBe(3);
  });

  test("rejects a previous ciphertext with no previous version", async () => {
    const { fetch } = trackedFetch([jsonResponse(200, { plaintext: "previous-plaintext" })]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_PREVIOUS_CIPHERTEXT: CIPHERTEXT_B,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await expect(resolvePlatformKeks(env, { fetch })).rejects.toThrow(
      /PLATFORM_KEK_PREVIOUS_VERSION must be set/,
    );
  });

  test("returns env unchanged and calls fetch zero times when nothing is set", async () => {
    const { fetch, calls } = trackedFetch([]);
    const env: KekSourceEnv = { SUBJECT_KEYS_DATABASE_URL: "postgres://localhost/x" };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result).toBe(env);
    expect(calls.length).toBe(0);
  });

  test("retries once on HTTP 500 and succeeds on the second attempt", async () => {
    const { fetch, calls } = trackedFetch([
      jsonResponse(500, {}),
      jsonResponse(200, { plaintext: PLAINTEXT_A }),
    ]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe(PLAINTEXT_A);
    expect(calls.length).toBe(2);
  });

  test("gives up after exactly one attempt on HTTP 403, no retry", async () => {
    const { fetch, calls } = trackedFetch([jsonResponse(403, {})]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await expect(resolvePlatformKeks(env, { fetch })).rejects.toThrow(/HTTP 403/);
    expect(calls.length).toBe(1);
  });

  test("throws when a 2xx response carries no plaintext field", async () => {
    const { fetch } = trackedFetch([jsonResponse(200, { notPlaintext: "x" })]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await expect(resolvePlatformKeks(env, { fetch })).rejects.toThrow(/no plaintext field/);
  });

  // The slot-to-version mapping is the part that "silently corrupts data when
  // it is wrong" (kms-wiring.ts) — this is the one test that would catch a
  // swapped active/previous assignment all the way through the adapter options.
  test("maps a decrypted active slot and a plaintext previous slot into the correct buildPgKmsOptions fields", async () => {
    const { fetch } = trackedFetch([jsonResponse(200, { plaintext: "decrypted-active" })]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
      PLATFORM_KEK_VERSION: "2",
      PLATFORM_KEK_PREVIOUS: "plaintext-previous",
      PLATFORM_KEK_PREVIOUS_VERSION: "1",
      SUBJECT_KEYS_DATABASE_URL: "postgres://localhost/x",
    };

    const resolved = await resolvePlatformKeks(env, { fetch });
    const options = buildPgKmsOptions({
      ...resolved,
      PLATFORM_KEK: resolved.PLATFORM_KEK ?? "",
      SUBJECT_KEYS_DATABASE_URL: resolved["SUBJECT_KEYS_DATABASE_URL"] ?? "",
    });

    expect(options.platformKek).toBe("decrypted-active");
    expect(options.previousKeks).toEqual({ 1: "plaintext-previous" });
  });

  test("rollback state: both plaintexts win over a leftover ciphertext, no fetch, no error", async () => {
    const { fetch, calls } = trackedFetch([]);
    const env: KekSourceEnv = {
      PLATFORM_KEK: "current-plaintext",
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_PREVIOUS: "rolled-back-plaintext",
      PLATFORM_KEK_PREVIOUS_CIPHERTEXT: CIPHERTEXT_B,
      PLATFORM_KEK_PREVIOUS_VERSION: "1",
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe("current-plaintext");
    expect(result.PLATFORM_KEK_PREVIOUS).toBe("rolled-back-plaintext");
    expect(calls.length).toBe(0);
  });

  test("names the ignored ciphertext when a leftover plaintext wins", async () => {
    const { fetch } = trackedFetch([]);
    const lines: string[] = [];
    const env: KekSourceEnv = {
      PLATFORM_KEK: PLAINTEXT_A,
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await resolvePlatformKeks(env, { fetch, log: (line) => lines.push(line), logPrefix: "[ps]" });

    expect(lines).toEqual([
      "[ps] PLATFORM_KEK source=plaintext-env (ciphertext present and ignored)",
    ]);
  });

  test("names the key id and region when the ciphertext is used, without the token or the key", async () => {
    const { fetch } = trackedFetch([jsonResponse(200, { plaintext: PLAINTEXT_A })]);
    const lines: string[] = [];
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    await resolvePlatformKeks(env, { fetch, log: (line) => lines.push(line) });

    expect(lines).toEqual(["PLATFORM_KEK source=key-manager keyId=key-1 region=fr-par"]);
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain(PLAINTEXT_A);
  });

  test("says nothing when neither slot is configured", async () => {
    const { fetch } = trackedFetch([]);
    const lines: string[] = [];

    await resolvePlatformKeks({}, { fetch, log: (line) => lines.push(line) });

    expect(lines).toEqual([]);
  });

  test("decrypts KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT into KUMIKO_BLIND_INDEX_KEY", async () => {
    const { fetch, calls } = trackedFetch([jsonResponse(200, { plaintext: PLAINTEXT_A })]);
    const env: KekSourceEnv = {
      KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.KUMIKO_BLIND_INDEX_KEY).toBe(PLAINTEXT_A);
    expect(calls.length).toBe(1);
  });

  test("a plaintext KUMIKO_BLIND_INDEX_KEY wins over its ciphertext, no fetch", async () => {
    const { fetch, calls } = trackedFetch([]);
    const env: KekSourceEnv = {
      KUMIKO_BLIND_INDEX_KEY: "blind-index-plaintext",
      KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT: CIPHERTEXT_A,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.KUMIKO_BLIND_INDEX_KEY).toBe("blind-index-plaintext");
    expect(calls.length).toBe(0);
  });

  test("ignores a ciphertext outside the allowlist entirely", async () => {
    const { fetch, calls } = trackedFetch([]);
    const env: KekSourceEnv = {
      FOO_CIPHERTEXT: CIPHERTEXT_A,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(calls.length).toBe(0);
    expect(result["FOO"]).toBeUndefined();
    expect(result).toBe(env);
  });

  test("decrypts PLATFORM_KEK and KUMIKO_BLIND_INDEX_KEY ciphertexts together", async () => {
    const { fetch, calls } = trackedFetch([
      jsonResponse(200, { plaintext: "active-plaintext" }),
      jsonResponse(200, { plaintext: "blind-index-plaintext" }),
    ]);
    const env: KekSourceEnv = {
      PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A,
      KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT: CIPHERTEXT_B,
      PLATFORM_KEK_KMS_KEY_ID: "key-1",
      PLATFORM_KEK_KMS_TOKEN: TOKEN,
    };

    const result = await resolvePlatformKeks(env, { fetch });

    expect(result.PLATFORM_KEK).toBe("active-plaintext");
    expect(result.KUMIKO_BLIND_INDEX_KEY).toBe("blind-index-plaintext");
    expect(calls.length).toBe(2);
  });

  describe("with schema-declared slots", () => {
    const KEY_MANAGER = { PLATFORM_KEK_KMS_KEY_ID: "key-1", PLATFORM_KEK_KMS_TOKEN: TOKEN };

    test("resolves a versioned master-key family without the framework knowing the versions", async () => {
      const { fetch, calls } = trackedFetch([
        jsonResponse(200, { plaintext: "v1-plaintext" }),
        jsonResponse(200, { plaintext: "v2-plaintext" }),
      ]);
      const env: KekSourceEnv = {
        KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: CIPHERTEXT_A,
        KUMIKO_SECRETS_MASTER_KEY_V2_CIPHERTEXT: CIPHERTEXT_B,
        ...KEY_MANAGER,
      };

      const result = await resolvePlatformKeks(env, {
        fetch,
        slots: ["KUMIKO_SECRETS_MASTER_KEY_V1", "KUMIKO_SECRETS_MASTER_KEY_V2"],
      });

      expect(result["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("v1-plaintext");
      expect(result["KUMIKO_SECRETS_MASTER_KEY_V2"]).toBe("v2-plaintext");
      expect(calls.length).toBe(2);
    });

    test("a plaintext beats its ciphertext per slot, the other slot still resolves", async () => {
      const { fetch, calls } = trackedFetch([jsonResponse(200, { plaintext: "v2-plaintext" })]);
      const env: KekSourceEnv = {
        KUMIKO_SECRETS_MASTER_KEY_V1: "v1-plaintext",
        KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: CIPHERTEXT_A,
        KUMIKO_SECRETS_MASTER_KEY_V2_CIPHERTEXT: CIPHERTEXT_B,
        ...KEY_MANAGER,
      };

      const result = await resolvePlatformKeks(env, {
        fetch,
        slots: ["KUMIKO_SECRETS_MASTER_KEY_V1", "KUMIKO_SECRETS_MASTER_KEY_V2"],
      });

      expect(result["KUMIKO_SECRETS_MASTER_KEY_V1"]).toBe("v1-plaintext");
      expect(result["KUMIKO_SECRETS_MASTER_KEY_V2"]).toBe("v2-plaintext");
      expect(calls.length).toBe(1);
    });

    test("does not touch the platform slots that the caller did not name", async () => {
      const { fetch, calls } = trackedFetch([]);
      const env: KekSourceEnv = { PLATFORM_KEK_CIPHERTEXT: CIPHERTEXT_A, ...KEY_MANAGER };

      const result = await resolvePlatformKeks(env, { fetch, slots: [] });

      expect(result).toBe(env);
      expect(calls.length).toBe(0);
    });

    test("logs the source line for a declared slot", async () => {
      const { fetch } = trackedFetch([jsonResponse(200, { plaintext: "v1-plaintext" })]);
      const lines: string[] = [];
      const env: KekSourceEnv = {
        KUMIKO_SECRETS_MASTER_KEY_V1_CIPHERTEXT: CIPHERTEXT_A,
        ...KEY_MANAGER,
      };

      await resolvePlatformKeks(env, {
        fetch,
        slots: ["KUMIKO_SECRETS_MASTER_KEY_V1"],
        log: (line) => lines.push(line),
      });

      expect(lines).toEqual([
        "KUMIKO_SECRETS_MASTER_KEY_V1 source=key-manager keyId=key-1 region=fr-par",
      ]);
    });

    test("still rejects a previous KEK without its version when that slot is declared", async () => {
      const { fetch } = trackedFetch([jsonResponse(200, { plaintext: "previous-plaintext" })]);
      const env: KekSourceEnv = { PLATFORM_KEK_PREVIOUS_CIPHERTEXT: CIPHERTEXT_B, ...KEY_MANAGER };

      await expect(
        resolvePlatformKeks(env, { fetch, slots: ["PLATFORM_KEK_PREVIOUS"] }),
      ).rejects.toThrow(/PLATFORM_KEK_PREVIOUS_VERSION must be set/);
    });
  });
});
