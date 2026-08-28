import { describe, expect, test } from "bun:test";
import type { S3ProviderConfig } from "../s3-provider";
import {
  collectPaginatedKeys,
  createS3Provider,
  resolveForcePathStyle,
  resolveVirtualHostedStyle,
} from "../s3-provider";

const baseConfig: S3ProviderConfig = {
  bucket: "b",
  region: "us-east-1",
  accessKeyId: "a",
  secretAccessKey: "s",
};

describe("resolveForcePathStyle", () => {
  test("no endpoint + no override → false (AWS virtual-host default)", () => {
    expect(resolveForcePathStyle(baseConfig)).toBe(false);
  });

  test("custom endpoint + no override → true (auto-detect for Minio/R2/etc.)", () => {
    expect(resolveForcePathStyle({ ...baseConfig, endpoint: "http://localhost:9000" })).toBe(true);
  });

  test("explicit true override always wins, even without endpoint", () => {
    expect(resolveForcePathStyle({ ...baseConfig, forcePathStyle: true })).toBe(true);
  });

  test("explicit false override always wins, even with custom endpoint", () => {
    // Edge case: someone running a custom endpoint that does support
    // virtual-host-style (rare, but legal) can opt out.
    expect(
      resolveForcePathStyle({
        ...baseConfig,
        endpoint: "http://localhost:9000",
        forcePathStyle: false,
      }),
    ).toBe(false);
  });
});

// virtualHostedStyle is the inversion createS3Provider hands to Bun.S3Client.
// The `!` is the silent drift point: flip it and Minio/R2 pick the wrong URL
// form with no compile or runtime error.
describe("resolveVirtualHostedStyle (inverse of forcePathStyle)", () => {
  const cases: ReadonlyArray<{ name: string; config: S3ProviderConfig }> = [
    { name: "no endpoint + no override", config: baseConfig },
    { name: "custom endpoint", config: { ...baseConfig, endpoint: "http://localhost:9000" } },
    { name: "explicit forcePathStyle true", config: { ...baseConfig, forcePathStyle: true } },
    {
      name: "custom endpoint + explicit false",
      config: { ...baseConfig, endpoint: "http://localhost:9000", forcePathStyle: false },
    },
  ];

  for (const { name, config } of cases) {
    test(`${name} → strict inverse of resolveForcePathStyle`, () => {
      expect(resolveVirtualHostedStyle(config)).toBe(!resolveForcePathStyle(config));
    });
  }

  test("AWS default (no endpoint) → virtual-host-style true", () => {
    expect(resolveVirtualHostedStyle(baseConfig)).toBe(true);
  });

  test("Minio/R2 (custom endpoint) → virtual-host-style false (= path-style)", () => {
    expect(resolveVirtualHostedStyle({ ...baseConfig, endpoint: "http://localhost:9000" })).toBe(
      false,
    );
  });
});

// collectPaginatedKeys owns the isTruncated/startAfter loop `list()` runs on
// top of a live client.list() — tested hermetically here (a real 1000+ key
// bucket would make this slow and flaky) so a regression in the loop itself
// (dropped page, infinite loop, wrong startAfter) fails fast without MinIO.
type FakePage = {
  readonly contents?: ReadonlyArray<{ readonly key: string }>;
  readonly isTruncated?: boolean;
};

describe("collectPaginatedKeys", () => {
  test("stops after a single non-truncated page", async () => {
    const keys = await collectPaginatedKeys(async () => ({
      contents: [{ key: "a" }, { key: "b" }],
      isTruncated: false,
    }));
    expect(keys).toEqual(["a", "b"]);
  });

  test("follows isTruncated across multiple pages, passing the last key as startAfter", async () => {
    const requestedStartAfters: Array<string | undefined> = [];
    const pages: readonly FakePage[] = [
      { contents: [{ key: "a" }, { key: "b" }], isTruncated: true },
      { contents: [{ key: "c" }, { key: "d" }], isTruncated: true },
      { contents: [{ key: "e" }], isTruncated: false },
    ];
    let call = 0;
    const keys = await collectPaginatedKeys(async (startAfter) => {
      requestedStartAfters.push(startAfter);
      const page = pages[call];
      call += 1;
      if (!page) throw new Error("unexpected extra page request");
      return page;
    });

    expect(keys).toEqual(["a", "b", "c", "d", "e"]);
    expect(requestedStartAfters).toEqual([undefined, "b", "d"]);
  });

  test("an empty page stops the loop even if isTruncated is (incorrectly) true", async () => {
    const keys = await collectPaginatedKeys(async () => ({
      contents: [],
      isTruncated: true,
    }));
    expect(keys).toEqual([]);
  });

  test("a page with no contents field is treated as empty", async () => {
    const keys = await collectPaginatedKeys(async () => ({}));
    expect(keys).toEqual([]);
  });
});

// presign is a pure local signing operation (HMAC, no network), so it tests
// hermetically with dummy credentials. Proves Bun actually signs contentDisposition
// as the response-content-disposition query param — otherwise a download would
// silently return the UUID key instead of the filename.
describe("getSignedUrl contentDisposition", () => {
  const provider = createS3Provider({
    bucket: "b",
    region: "us-east-1",
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "secret",
  });

  test("signs response-content-disposition into the presigned URL", async () => {
    const url = await provider.getSignedUrl?.("uuid-key.bin", 60, {
      contentDisposition: 'attachment; filename="report.pdf"',
    });
    expect(url).toBeDefined();
    const params = new URL(url ?? "").searchParams;
    expect(params.get("response-content-disposition")).toBe('attachment; filename="report.pdf"');
  });

  test("omits the param when no contentDisposition is passed", async () => {
    const url = await provider.getSignedUrl?.("uuid-key.bin", 60);
    expect(url).toBeDefined();
    expect(new URL(url ?? "").searchParams.has("response-content-disposition")).toBe(false);
  });
});
