// scaffoldAppFeature unit-tests (DX-2).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { scaffoldApp } from "../scaffold-app";
import { scaffoldAppFeature } from "../scaffold-app-feature";

describe("scaffoldAppFeature", () => {
  let tmp: string;
  let appRoot: string;
  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "scaffold-app-feature-"));
    appRoot = join(tmp, "my-shop");
    await scaffoldApp({ name: "my-shop", destination: appRoot });
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scaffolds die volle App-Feature-Konvention", () => {
    const result = scaffoldAppFeature({ name: "product-catalog", appRoot });
    expect(result.featureName).toBe("product-catalog");
    expect(result.files).toEqual([
      "src/features/product-catalog/feature.ts",
      "src/features/product-catalog/index.ts",
      "src/features/product-catalog/constants.ts",
      "src/features/product-catalog/i18n.ts",
      "src/features/product-catalog/schema/product-catalog-item.ts",
      "src/features/product-catalog/schema/index.ts",
      "src/features/product-catalog/web/index.ts",
      "src/features/product-catalog/__tests__/feature.boot.test.ts",
    ]);
    for (const file of result.files) {
      expect(existsSync(join(appRoot, file))).toBe(true);
    }
  });

  test("feature.ts registriert nur — Entity aus schema/, Keys aus i18n.ts", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const feature = readFileSync(join(appRoot, "src/features/product-catalog/feature.ts"), "utf-8");
    expect(feature).toContain("defineFeature(PRODUCT_CATALOG_FEATURE");
    expect(feature).toContain("export const productCatalogFeature");
    expect(feature).toContain('r.entity("product-catalog-item", productCatalogItemEntity)');
    expect(feature).toContain('type: "entityList"');
    expect(feature).toContain("r.translations({ keys: productCatalogTranslationKeys })");
    // Konvention: Entity-Felder leben in schema/, nicht inline in feature.ts.
    expect(feature).not.toContain("fields:");
  });

  test("Starter erfüllt Boot-Constraints: sortable-Feld, defaultSort, i18n-Pflichtkeys", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const entity = readFileSync(
      join(appRoot, "src/features/product-catalog/schema/product-catalog-item.ts"),
      "utf-8",
    );
    expect(entity).toContain("sortable: true");
    const feature = readFileSync(join(appRoot, "src/features/product-catalog/feature.ts"), "utf-8");
    expect(feature).toContain('defaultSort: { field: "title", dir: "asc" }');
    const i18n = readFileSync(join(appRoot, "src/features/product-catalog/i18n.ts"), "utf-8");
    expect(i18n).toContain('"screen:items.title"');
    expect(i18n).toContain('"product-catalog:entity:product-catalog-item:field:title"');
  });

  test("web/index.ts ist Client-Stub, __tests__ enthält validateBoot-Test", () => {
    scaffoldAppFeature({ name: "product-catalog", appRoot });
    const web = readFileSync(join(appRoot, "src/features/product-catalog/web/index.ts"), "utf-8");
    expect(web).toContain("@runtime client");
    expect(web).toContain("export const productCatalogClient: ClientFeatureDefinition");
    const bootTest = readFileSync(
      join(appRoot, "src/features/product-catalog/__tests__/feature.boot.test.ts"),
      "utf-8",
    );
    expect(bootTest).toContain("validateBoot([productCatalogFeature])");
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

  test("gescaffoldetes Feature bootet wirklich (validateBoot über dynamic import)", async () => {
    // Ins Repo scaffolden (nicht os.tmpdir): nur hier löst der dynamic
    // import "@cosmicdrift/kumiko-framework/engine" über node_modules auf.
    const repoTmp = mkdtempSync(join(import.meta.dir, ".tmp-scaffold-"));
    try {
      scaffoldAppFeature({ name: "boot-probe", appRoot: repoTmp });
      const mod = (await import(join(repoTmp, "src/features/boot-probe/feature.ts"))) as {
        readonly bootProbeFeature: Parameters<typeof validateBoot>[0][number];
      };
      expect(() => validateBoot([mod.bootProbeFeature])).not.toThrow();
    } finally {
      rmSync(repoTmp, { recursive: true, force: true });
    }
  });

  test("rejects non-kebab-case", () => {
    expect(() => scaffoldAppFeature({ name: "ProductCatalog", appRoot })).toThrow(/kebab-case/);
    expect(() => scaffoldAppFeature({ name: "product_catalog", appRoot })).toThrow(/kebab-case/);
  });

  test("rejects trailing- and double-hyphen names (kebabToCamel would break)", () => {
    // `product-` → kebabToCamel leaves a trailing hyphen → `product-Feature`,
    // an invalid identifier. The segment-strict regex must reject these.
    expect(() => scaffoldAppFeature({ name: "product-", appRoot })).toThrow(/kebab-case/);
    expect(() => scaffoldAppFeature({ name: "foo--bar", appRoot })).toThrow(/kebab-case/);
  });

  test("rolls back the scaffolded dir when run-config has no APP_FEATURES (re-run not blocked)", () => {
    // run-config exists but is the wrong shape → mountInRunConfig throws. The
    // feature files were already written; without rollback a re-run would hit
    // the "already exists" guard and the user would be stuck.
    const runConfigPath = join(appRoot, "src/run-config.ts");
    writeFileSync(runConfigPath, "export const NOT_APP_FEATURES = [];\n", "utf-8");

    expect(() => scaffoldAppFeature({ name: "orders", appRoot })).toThrow(/APP_FEATURES/);
    // Rolled back: the half-written feature dir is gone.
    expect(existsSync(join(appRoot, "src/features/orders"))).toBe(false);

    // Re-run with a valid run-config now succeeds instead of "already exists".
    writeFileSync(runConfigPath, "export const APP_FEATURES = [] as const;\n", "utf-8");
    const result = scaffoldAppFeature({ name: "orders", appRoot });
    expect(result.autoMounted).toBe(true);
    expect(existsSync(join(appRoot, "src/features/orders/feature.ts"))).toBe(true);
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
