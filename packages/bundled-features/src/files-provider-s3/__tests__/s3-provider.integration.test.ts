import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FileStorageProvider } from "@cosmicdrift/kumiko-framework/files";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
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

beforeAll(async () => {
  const endpoint = requireEnv("MINIO_ENDPOINT");
  // Fail loud with an actionable message when Minio is down (otherwise
  // S3 networking errors look like provider bugs).
  try {
    const health = await fetch(`${endpoint.replace(/\/$/, "")}/minio/health/live`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) {
      throw new Error(`HTTP ${health.status}`);
    }
  } catch (err) {
    throw new Error(
      `MinIO not reachable at ${endpoint} — run: docker compose up -d minio minio-init ` +
        `(kumiko-framework compose, default port 19000). ` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // forcePathStyle is deliberately NOT set — resolveForcePathStyle() must
  // auto-detect path-style from the `endpoint` presence. If auto-detection
  // regressed, Minio would reject virtual-host-style URLs (bucket.host/key)
  // and every round-trip below would fail. That's the proof.
  provider = createS3Provider({
    endpoint,
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

  test("writeStream round-trip via multipart writer preserves byte-exact ordering", async () => {
    // Regression guard for the multipart-flush bug: the source chunks are
    // deliberately NON-ALIGNED to the 5 MiB part boundary ([3,3,2] MiB → the
    // internal part split at 5 MiB lands mid-chunk #2). The old
    // `buffered >= STREAM_PART_SIZE` flush would emit a non-final part of an
    // odd size at that boundary; the Bun-writer (partSize) path produces the
    // correct part topology. Either way we verify END-TO-END byte integrity,
    // not just total size + first/last byte.
    //
    // Each chunk carries a chunk-distinct content pattern (incl. a per-chunk
    // marker in byte[0]). A re-order, dropped, or duplicated part therefore
    // changes the readback SHA256 — a same-pattern-per-part test would not
    // catch that. We assert both the SHA256 over the whole stream AND the
    // per-chunk-offset marker bytes.
    //
    // NOTE: MinIO does NOT enforce the AWS `MinPartSize` (5 MiB non-final
    // part) rule, so this test cannot reproduce the genuine S3 `EntityTooSmall`
    // rejection — that needs a manual smoke against AWS/R2. What it DOES guard
    // is byte-ordering/integrity of the multipart round-trip, which is
    // provider-agnostic.
    const key = uniqueKey("stream-multipart.bin");
    const partSize = 5 * 1024 * 1024;
    const MiB = 1024 * 1024;
    const chunkSizes = [3 * MiB, 3 * MiB, 2 * MiB]; // 8 MiB total, non-aligned to 5 MiB

    function makeChunk(index: number, size: number): Uint8Array {
      const c = new Uint8Array(size);
      // byte[0] = chunk marker; remaining bytes mix index + position so each
      // chunk's body is distinct (reorder/duplicate changes the hash).
      c[0] = index;
      for (let i = 1; i < size; i++) c[i] = (index * 31 + i) % 251;
      return c;
    }
    const chunks = chunkSizes.map((size, i) => makeChunk(i, size));

    // Expected hash over the concatenated source.
    const sourceHasher = new Bun.CryptoHasher("sha256");
    for (const c of chunks) sourceHasher.update(c);
    const expectedHash = sourceHasher.digest("hex");

    if (!provider.writeStream) throw new Error("s3 provider should implement writeStream");
    await provider.writeStream(
      key,
      (async function* () {
        for (const c of chunks) yield c;
      })(),
    );

    const readBack = await provider.read(key);
    const totalSize = chunkSizes.reduce((a, b) => a + b, 0);
    expect(readBack.byteLength).toBe(totalSize);
    expect(readBack.byteLength).toBeGreaterThan(partSize);

    // Byte-exact integrity over the full stream — catches any mid-stream
    // corruption / reorder / off-by-part the size+endpoints check would miss.
    const readHasher = new Bun.CryptoHasher("sha256");
    readHasher.update(readBack);
    expect(readHasher.digest("hex")).toBe(expectedHash);

    // Explicit per-chunk marker check at the expected source offsets — proves
    // the parts landed in order (not just that the bytes are collectively
    // present).
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      expect(readBack[offset]).toBe(i);
      offset += chunkSizes[i] ?? 0;
    }
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
