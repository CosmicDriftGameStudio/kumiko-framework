import type { FileStorageProvider } from "@kumiko/framework/files";
import { generateId } from "@kumiko/framework/utils";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createS3ProviderFromEnv } from "../env-helper";
import { createS3Provider } from "../s3-provider";

// These tests run against the Minio container from docker-compose
// (kumiko dev starts it alongside postgres/redis/meili). If Minio isn't up
// the tests fail fast — same as postgres, not env-gated.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env for S3 integration test: ${name}`);
  return value;
}

// Keep all keys under a per-run prefix so repeated test runs don't pollute
// each other and a stray failure doesn't leak bytes into the next developer's
// session. Cleanup happens in afterAll via the provider's delete().
const RUN_PREFIX = `test-run-${generateId()}`;
const createdKeys: string[] = [];

function uniqueKey(suffix: string): string {
  const key = `${RUN_PREFIX}/${suffix}`;
  createdKeys.push(key);
  return key;
}

let provider: FileStorageProvider;

beforeAll(() => {
  // forcePathStyle is deliberately NOT set — resolveForcePathStyle() must
  // auto-detect path-style from the `endpoint` presence. If auto-detection
  // regressed, Minio would reject virtual-host-style URLs (bucket.host/key)
  // and every round-trip below would fail. That's the proof.
  provider = createS3Provider({
    endpoint: requireEnv("MINIO_ENDPOINT"),
    region: requireEnv("MINIO_REGION"),
    accessKeyId: requireEnv("MINIO_ACCESS_KEY"),
    secretAccessKey: requireEnv("MINIO_SECRET_KEY"),
    bucket: requireEnv("MINIO_BUCKET"),
  });
});

afterAll(async () => {
  // Best-effort cleanup — don't fail the suite if a key can't be removed.
  for (const key of createdKeys) {
    try {
      await provider.delete(key);
    } catch {
      // ignore: test isolation doesn't depend on clean teardown
    }
  }
});

describe("s3-provider (Minio)", () => {
  test("write + read round-trip preserves bytes", async () => {
    const key = uniqueKey("round-trip.bin");
    const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03, 0xff]);

    await provider.write(key, payload, "application/octet-stream");
    const readBack = await provider.read(key);

    expect(readBack.length).toBe(payload.length);
    expect(Array.from(readBack)).toEqual(Array.from(payload));
  });

  test("exists reflects write + delete", async () => {
    const key = uniqueKey("exists-check.txt");

    expect(await provider.exists(key)).toBe(false);

    await provider.write(key, new TextEncoder().encode("hello"), "text/plain");
    expect(await provider.exists(key)).toBe(true);

    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  test("getSignedUrl returns a URL that fetches the bytes", async () => {
    const key = uniqueKey("signed-download.txt");
    const payload = new TextEncoder().encode("signed-url-payload");

    await provider.write(key, payload, "text/plain");

    // getSignedUrl is optional on the contract; the S3 provider always
    // implements it. Narrow for TS.
    if (!provider.getSignedUrl) throw new Error("s3 provider should implement getSignedUrl");
    const url = await provider.getSignedUrl(key, 60, {
      contentDisposition: 'attachment; filename="original.txt"',
    });

    expect(url).toMatch(/^https?:\/\//);
    // The signed URL goes to the MINIO_ENDPOINT, not a virtual-host-style
    // host — proves forcePathStyle is on.
    expect(url).toContain("localhost:19000");
    // Presigner encodes the expiry as X-Amz-Expires.
    expect(url).toContain("X-Amz-Expires=60");
    // Content-Disposition override is presigned into the query string.
    expect(url.toLowerCase()).toContain("response-content-disposition");

    // Fetch through the URL — proves it actually works end-to-end.
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const fetched = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(fetched)).toEqual(Array.from(payload));
  });

  test("read throws on missing key", async () => {
    const key = uniqueKey("never-existed.bin");
    await expect(provider.read(key)).rejects.toThrow();
  });
});

describe("createS3ProviderFromEnv", () => {
  test("builds a working provider from MINIO_* env vars", async () => {
    // Construct via env-helper with the MINIO_ prefix to match the docker
    // container's env. Then prove it works by writing + reading through it.
    const envProvider = createS3ProviderFromEnv("MINIO_");
    const key = uniqueKey("env-helper-check.bin");
    const payload = new Uint8Array([1, 2, 3, 4]);

    await envProvider.write(key, payload);
    const readBack = await envProvider.read(key);
    expect(Array.from(readBack)).toEqual(Array.from(payload));
    await envProvider.delete(key);
  });

  test("throws for missing required env var", () => {
    // Any prefix that doesn't map to any env vars should yield a missing_env
    // error immediately — not a silent misconfiguration at first I/O.
    expect(() => createS3ProviderFromEnv("NON_EXISTENT_PREFIX_")).toThrow(/missing_env/);
  });
});
