// Unit-Tests für cacheHeadersFor — die Cache-Strategie hinter
// runProdApp's static-fallback. Pure function, leicht zu testen.
//
// Strategie (siehe run-prod-app.ts):
//   /assets/*               → max-age=31536000, immutable
//   /, /index.html          → no-cache, must-revalidate
//   /manifest.json, /sw.js  → no-cache
//   alles andere            → kein expliziter Header

import { describe, expect, test } from "bun:test";
import { cacheHeadersFor } from "../run-prod-app";

describe("cacheHeadersFor", () => {
  test("hashed asset → immutable + 1 Jahr", () => {
    expect(cacheHeadersFor("/assets/client-abc123.js")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("hashed CSS asset → immutable + 1 Jahr", () => {
    expect(cacheHeadersFor("/assets/styles-def456.css")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("nested asset path → immutable", () => {
    expect(cacheHeadersFor("/assets/chunks/foo-789.js")).toEqual({
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  test("/ → no-cache, must-revalidate", () => {
    expect(cacheHeadersFor("/")).toEqual({
      "cache-control": "no-cache, must-revalidate",
    });
  });

  test("/index.html → no-cache, must-revalidate", () => {
    expect(cacheHeadersFor("/index.html")).toEqual({
      "cache-control": "no-cache, must-revalidate",
    });
  });

  test("/manifest.json → no-cache", () => {
    expect(cacheHeadersFor("/manifest.json")).toEqual({
      "cache-control": "no-cache",
    });
  });

  test("/sw.js → no-cache", () => {
    expect(cacheHeadersFor("/sw.js")).toEqual({
      "cache-control": "no-cache",
    });
  });

  test("public-folder file (favicon) → kein expliziter Header", () => {
    expect(cacheHeadersFor("/favicon.ico")).toEqual({});
  });

  test("public-folder file (og-image) → kein expliziter Header", () => {
    expect(cacheHeadersFor("/og-image.png")).toEqual({});
  });

  test("path mit assets als Substring (kein /assets/ prefix) → kein immutable", () => {
    // Schutz: /myassets/foo.js soll NICHT immutable kriegen — wäre ein Bug
    // weil die nicht gehashed sind.
    expect(cacheHeadersFor("/myassets/foo.js")).toEqual({});
    expect(cacheHeadersFor("/foo/assets/bar.js")).toEqual({});
  });
});
