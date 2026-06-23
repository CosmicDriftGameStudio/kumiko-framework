// Unit-Tests für staticCachePolicy — die Cache-Strategie hinter
// runProdApp's static-fallback. Pure function, leicht zu testen.
//
// Strategie (siehe run-prod-app.ts):
//   /assets/*               → immutable
//   /, /index.html          → revalidate (max-age=0, must-revalidate)
//   /manifest.json, /sw.js,
//   /build-info.json        → no-cache
//   alles andere            → none

import { describe, expect, test } from "bun:test";
import { cacheControlHeader } from "@cosmicdrift/kumiko-framework/api";
import { staticCachePolicy } from "../run-prod-app";

function cacheControlFor(pathname: string): Record<string, string> {
  const header = cacheControlHeader(staticCachePolicy(pathname));
  return header === undefined ? {} : { "cache-control": header };
}

describe("staticCachePolicy", () => {
  test("hashed asset → immutable + 1 Jahr", () => {
    expect(cacheControlFor("/assets/client-abc123.js")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("hashed CSS asset → immutable + 1 Jahr", () => {
    expect(cacheControlFor("/assets/styles-def456.css")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("nested asset path → immutable", () => {
    expect(cacheControlFor("/assets/chunks/foo-789.js")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("/ → revalidate", () => {
    expect(cacheControlFor("/")).toEqual({
      "cache-control": "public, max-age=0, must-revalidate",
    });
  });

  test("/index.html → revalidate", () => {
    expect(cacheControlFor("/index.html")).toEqual({
      "cache-control": "public, max-age=0, must-revalidate",
    });
  });

  test("/manifest.json → no-cache", () => {
    expect(cacheControlFor("/manifest.json")).toEqual({
      "cache-control": "no-cache",
    });
  });

  test("/sw.js → no-cache", () => {
    expect(cacheControlFor("/sw.js")).toEqual({
      "cache-control": "no-cache",
    });
  });

  test("/build-info.json → no-cache (sonst pollt UpdateChecker eine veraltete id)", () => {
    expect(cacheControlFor("/build-info.json")).toEqual({
      "cache-control": "no-cache",
    });
  });

  test("public-folder file (favicon) → kein expliziter Header", () => {
    expect(cacheControlFor("/favicon.ico")).toEqual({});
  });

  test("public-folder file (og-image) → kein expliziter Header", () => {
    expect(cacheControlFor("/og-image.png")).toEqual({});
  });

  test("path mit assets als Substring (kein /assets/ prefix) → kein immutable", () => {
    // Schutz: /myassets/foo.js soll NICHT immutable kriegen — wäre ein Bug
    // weil die nicht gehashed sind.
    expect(cacheControlFor("/myassets/foo.js")).toEqual({});
    expect(cacheControlFor("/foo/assets/bar.js")).toEqual({});
  });
});
