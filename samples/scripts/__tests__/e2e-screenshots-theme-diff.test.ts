// findIdenticalThemeScreenshots — the per-viewport hash-collision guard
// runMatrix uses to fail when two themes render byte-identical screenshots
// (issue 1730: MIN_BYTES alone can't catch a renamed CSS class or an
// overridden theme provider, since a valid PNG stays a valid PNG regardless
// of which theme produced it).
//
// Lives outside samples/e2e/ on purpose — bunfig.toml excludes **/e2e/**
// from bun test (that tree is Playwright .spec.ts territory).

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { findIdenticalThemeScreenshots, type ThemeScreenshotDigest } from "../../e2e/screenshots";

function hashOf(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(viewport: string, theme: string, bytes: string): ThemeScreenshotDigest<string> {
  return { viewport, theme, hash: hashOf(bytes) };
}

describe("findIdenticalThemeScreenshots", () => {
  test("returns no violations when every theme renders distinct pixels", () => {
    const digests = [
      digest("desktop", "default-light", "light-desktop-pixels"),
      digest("desktop", "default-dark", "dark-desktop-pixels"),
      digest("mobile", "default-light", "light-mobile-pixels"),
      digest("mobile", "default-dark", "dark-mobile-pixels"),
    ];
    expect(findIdenticalThemeScreenshots(digests)).toEqual([]);
  });

  test("flags two themes that hash identically at the same viewport", () => {
    const digests = [
      digest("desktop", "default-light", "same-pixels"),
      digest("desktop", "default-dark", "same-pixels"),
    ];
    const violations = findIdenticalThemeScreenshots(digests);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('viewport "desktop"');
    expect(violations[0]).toContain('"default-light"');
    expect(violations[0]).toContain('"default-dark"');
  });

  test("does not flag identical hashes across different viewports", () => {
    // The guard is scoped per viewport by design (see the function's own
    // comment) so a collision at desktop never gets reported under mobile.
    const digests = [
      digest("desktop", "default-light", "shared-pixels"),
      digest("mobile", "default-light", "shared-pixels"),
    ];
    expect(findIdenticalThemeScreenshots(digests)).toEqual([]);
  });

  test("reports one violation per viewport when every theme collapses to the same render", () => {
    const digests = [
      digest("desktop", "default-light", "broken-pixels"),
      digest("desktop", "default-dark", "broken-pixels"),
      digest("mobile", "default-light", "broken-pixels"),
      digest("mobile", "default-dark", "broken-pixels"),
    ];
    const violations = findIdenticalThemeScreenshots(digests);
    expect(violations).toHaveLength(2);
  });

  test("returns no violations for an empty digest list", () => {
    expect(findIdenticalThemeScreenshots([])).toEqual([]);
  });
});
