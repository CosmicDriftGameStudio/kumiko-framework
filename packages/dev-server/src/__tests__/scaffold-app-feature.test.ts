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

  test("mounting a second feature keeps the first feature's import exactly once", () => {
    // Cross-feature non-duplication: adding billing must not touch the
    // product-catalog import/entry. Same-feature re-mount idempotency is the
    // next test — the dir-exists guard blocks a direct second scaffold of the
    // same name, so this one cannot reach the short-circuit branches.
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const firstRunConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    scaffoldAppFeature({ name: "billing", appRoot });
    const secondRunConfig = readFileSync(join(appRoot, "src/run-config.ts"), "utf-8");
    expect(secondRunConfig).toContain("productCatalogFeature");
    expect(secondRunConfig).toContain("billingFeature");
    // Count: each feature-import appears exactly once.
    const occurrences = secondRunConfig.match(/productCatalogFeature/g) ?? [];
    expect(occurrences.length).toBe(2); // 1 import + 1 array-entry
    expect(firstRunConfig.length).toBeLessThan(secondRunConfig.length);
  });

  test("idempotent: re-scaffolding the same feature is a full no-op on run-config", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const runConfigPath = join(appRoot, "src/run-config.ts");
    const afterFirst = readFileSync(runConfigPath, "utf-8");

    // Drop only the feature dir so the dir-exists guard doesn't trip; the
    // run-config import + APP_FEATURES entry both survive. The re-scaffold must
    // hit the full short-circuit in mountInRunConfig (import present AND
    // alreadyListed → changed=false → no save) and duplicate neither half —
    // the branch the cross-feature test above never reaches.
    rmSync(join(appRoot, "src/features/product-catalog"), { recursive: true, force: true });
    const result = scaffoldAppFeature({ name: "product-catalog", appRoot });
    expect(result.autoMounted).toBe(true);

    const afterSecond = readFileSync(runConfigPath, "utf-8");
    expect(afterSecond).toBe(afterFirst); // byte-identical: no save, no duplication
    expect((afterSecond.match(/productCatalogFeature/g) ?? []).length).toBe(2);
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
