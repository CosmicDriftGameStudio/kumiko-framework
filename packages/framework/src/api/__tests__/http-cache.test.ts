import { describe, expect, test } from "bun:test";
import {
  cacheControlHeader,
  cachedResponse,
  computeRevisionEtag,
  computeStrongEtag,
  computeWeakEtag,
  etagMatches,
  parseIfNoneMatch,
} from "../http-cache";

describe("computeWeakEtag", () => {
  test("formats mtime-size weak tag", () => {
    expect(computeWeakEtag(1_700_000_000_000, 4096)).toBe('W/"1700000000000-4096"');
  });
});

describe("computeStrongEtag", () => {
  test("same seed → same tag", () => {
    expect(computeStrongEtag("hello")).toBe(computeStrongEtag("hello"));
  });

  test("different seed → different tag", () => {
    expect(computeStrongEtag("hello")).not.toBe(computeStrongEtag("world"));
  });
});

describe("computeRevisionEtag", () => {
  test("stable for same parts", () => {
    const parts = ["tenant-a", "about", "de", "3", "2026-01-01T00:00:00.000Z"];
    expect(computeRevisionEtag(parts)).toBe(computeRevisionEtag(parts));
  });
});

describe("cacheControlHeader", () => {
  test("immutable default", () => {
    expect(cacheControlHeader({ kind: "immutable" })).toBe("public, max-age=31536000, immutable");
  });

  test("revalidate default", () => {
    expect(cacheControlHeader({ kind: "revalidate" })).toBe("public, max-age=0, must-revalidate");
  });

  test("no-cache", () => {
    expect(cacheControlHeader({ kind: "no-cache" })).toBe("no-cache");
  });

  test("none → undefined", () => {
    expect(cacheControlHeader({ kind: "none" })).toBeUndefined();
  });
});

describe("parseIfNoneMatch", () => {
  test("empty / null", () => {
    expect(parseIfNoneMatch(null)).toEqual([]);
    expect(parseIfNoneMatch("")).toEqual([]);
  });

  test("single tag", () => {
    expect(parseIfNoneMatch('"abc"')).toEqual(['"abc"']);
  });

  test("multiple tags", () => {
    expect(parseIfNoneMatch(' "a" , W/"b" ')).toEqual(['"a"', 'W/"b"']);
  });

  test("wildcard", () => {
    expect(parseIfNoneMatch("*")).toEqual(["*"]);
  });
});

describe("etagMatches", () => {
  const etag = '"deadbeef"';

  test("no header → false", () => {
    expect(etagMatches(null, etag)).toBe(false);
  });

  test("exact match", () => {
    expect(etagMatches('"deadbeef"', etag)).toBe(true);
  });

  test("weak matches strong value", () => {
    expect(etagMatches('W/"deadbeef"', etag)).toBe(true);
    expect(etagMatches('"deadbeef"', 'W/"deadbeef"')).toBe(true);
  });

  test("wildcard", () => {
    expect(etagMatches("*", etag)).toBe(true);
  });

  test("mismatch", () => {
    expect(etagMatches('"other"', etag)).toBe(false);
  });
});

describe("cachedResponse", () => {
  const etag = computeStrongEtag("body");

  test("200 with body and headers", () => {
    const res = cachedResponse(new Request("https://example.test/"), {
      body: "hello",
      etag,
      cache: { kind: "revalidate" },
      headers: { "content-type": "text/plain" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe(etag);
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(res.headers.get("content-type")).toBe("text/plain");
  });

  test("304 when If-None-Match matches", async () => {
    const req = new Request("https://example.test/", {
      headers: { "if-none-match": etag },
    });
    const res = cachedResponse(req, {
      body: "hello",
      etag,
      cache: { kind: "revalidate" },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  test("HEAD returns no body", async () => {
    const res = cachedResponse(new Request("https://example.test/", { method: "HEAD" }), {
      body: "hello",
      etag,
      cache: { kind: "revalidate" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  test("304 via If-Modified-Since", () => {
    const lastModified = new Date("2026-06-01T12:00:00.000Z");
    const req = new Request("https://example.test/", {
      headers: { "if-modified-since": lastModified.toUTCString() },
    });
    const res = cachedResponse(req, {
      body: "hello",
      etag,
      cache: { kind: "revalidate" },
      lastModified,
    });
    expect(res.status).toBe(304);
  });
});
