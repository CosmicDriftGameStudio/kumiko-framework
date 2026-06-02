// scaffoldAppFeature unit-tests (DX-2).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldApp } from "../scaffold-app";
import { scaffoldAppFeature } from "../scaffold-app-feature";

describe("scaffoldAppFeature", () => {
  let tmp: string;
  let appRoot: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "scaffold-app-feature-"));
    appRoot = join(tmp, "my-shop");
    scaffoldApp({ name: "my-shop", destination: appRoot });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds src/features/<name>/feature.ts + index.ts", () => {
    const result = scaffoldAppFeature({ name: "product-catalog", appRoot });
    expect(result.featureName).toBe("product-catalog");
    expect(result.files).toEqual([
      "src/features/product-catalog/feature.ts",
      "src/features/product-catalog/index.ts",
    ]);
    expect(existsSync(join(appRoot, "src/features/product-catalog/feature.ts"))).toBe(true);
    expect(existsSync(join(appRoot, "src/features/product-catalog/index.ts"))).toBe(true);
  });

  test("feature.ts uses kebab-name + camelCase variable", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const feature = readFileSync(join(appRoot, "src/features/product-catalog/feature.ts"), "utf-8");
    expect(feature).toContain(`defineFeature("product-catalog"`);
    expect(feature).toContain("export const productCatalogFeature");
    expect(feature).toContain('r.entity("product-catalog-item"');
  });

  test("auto-mounts in src/run-config.ts (import + APP_FEATURES entry)", () => {
    const result = scaffoldAppFeature({ name: "product-catalog", appRoot });
    expect(result.autoMounted).toBe(true);
    const runConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    expect(runConfig).toContain(
      `import { productCatalogFeature } from "./features/product-catalog";`,
    );
    expect(runConfig).toContain("productCatalogFeature");
    // APP_FEATURES still ends with `as const`
    expect(runConfig).toMatch(/\]\s*as const;/);
  });

  test("idempotent: re-mount of existing feature is a no-op", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const firstRunConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    // Now re-mount (second feature creates dir-already-exists error;
    // we instead simulate "feature dir exists, only run-config dance").
    // → Real DX-2 flow: scaffold fails on dir-exists; manual remount
    //   would call mountInRunConfig directly. Test the mount-side
    //   idempotency by triggering a second feature with a different
    //   name and asserting the first import stays exactly once.
    scaffoldAppFeature({ name: "billing", appRoot });
    const secondRunConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    expect(secondRunConfig).toContain("productCatalogFeature");
    expect(secondRunConfig).toContain("billingFeature");
    // Count: each feature-import appears exactly once.
    const occurrences = secondRunConfig.match(/productCatalogFeature/g) ?? [];
    expect(occurrences.length).toBe(2); // 1 import + 1 array-entry
    expect(firstRunConfig.length).toBeLessThan(secondRunConfig.length);
  });

  test("self-heals a half-mounted run-config: import present but APP_FEATURES entry removed", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const runConfigPath = join(appRoot, "src/run-config.ts");

    // Simulate a half-applied state: the feature dir is gone and the
    // APP_FEATURES entry was hand-removed, but the import line still lingers.
    rmSync(join(appRoot, "src/features/product-catalog"), { recursive: true, force: true });
    const stripped = readFileSync(runConfigPath, "utf-8")
      // Drop the APP_FEATURES array element (appended last, so `, productCatalogFeature`
      // right before the closing `]`). The import `{ productCatalogFeature }` is
      // followed by ` }`, not `]`/`,`, so the lookahead leaves it intact.
      .replace(/,\s*productCatalogFeature(?=\s*\])/, "");
    writeFileSync(runConfigPath, stripped, "utf-8");
    // Guard the simulation itself: the import must remain, the array entry must
    // be gone — exactly one mention left. Without this, a regex that failed to
    // strip would leave the entry in place and the test would false-pass.
    expect(stripped).toContain(
      'import { productCatalogFeature } from "./features/product-catalog";',
    );
    expect((stripped.match(/productCatalogFeature/g) ?? []).length).toBe(1);

    // Re-scaffold: dir is gone so it proceeds; mountInRunConfig sees the import
    // already present and must still re-add the missing APP_FEATURES entry.
    const result = scaffoldAppFeature({ name: "product-catalog", appRoot });
    expect(result.autoMounted).toBe(true);

    const healed = readFileSync(runConfigPath, "utf-8");
    // Import stays exactly once; the array entry is back.
    const occurrences = healed.match(/productCatalogFeature/g) ?? [];
    expect(occurrences.length).toBe(2); // 1 import + 1 array-entry
    expect(healed).toMatch(/\]\s*as const;/);
  });

  test("rejects non-kebab-case", () => {
    expect(() => scaffoldAppFeature({ name: "ProductCatalog", appRoot })).toThrow(/kebab-case/);
    expect(() => scaffoldAppFeature({ name: "product_catalog", appRoot })).toThrow(/kebab-case/);
  });

  test("refuses to overwrite existing feature dir", () => {
    scaffoldAppFeature({ name: "billing", appRoot });
    expect(() => scaffoldAppFeature({ name: "billing", appRoot })).toThrow(/already exists/);
  });

  test("autoMounted=false when run-config.ts is missing", () => {
    const emptyRoot = join(tmp, "no-app");
    expect(() => scaffoldAppFeature({ name: "foo", appRoot: emptyRoot })).not.toThrow();
    const result = scaffoldAppFeature({ name: "bar", appRoot: emptyRoot });
    expect(result.autoMounted).toBe(false);
  });
});
