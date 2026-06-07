// Boot smoke-test for use-all-bundled. Runs every bundled-feature
// through composeFeatures + validateBoot + createRegistry without
// DB/Redis (KUMIKO_DRY_RUN_ENV=boot path). This is the CI-gate that
// catches Sprint-9.8-style framework-bugs (Object.entries(undefined),
// self-extension, missing-requires, …) before they reach a real app.
//
// Scope: this file tests THIS SAMPLE's boot wiring. Framework-level
// composeFeatures behaviour (auth-mode bundled-prepend, ordering) is
// covered by framework's own tests — mixing scopes here would let
// a framework-refactor fail the sample's CI for the wrong reason.
// Coverage of "every bundled-export is mounted" lives in M5's
// scripts/check-coverage.ts, not in a brittle hardcoded count-assert.

import { describe, expect, test } from "bun:test";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server/compose-features";
import { extractTableInfo } from "@cosmicdrift/kumiko-framework/bun-db";
import { enumerateFeatureTableSources } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { ENTITY_METAS } from "../../kumiko/schema";
import { APP_FEATURES } from "../run-config";

const composedFeatures = composeFeatures([...APP_FEATURES], {
  includeBundled: true,
});

describe("use-all-bundled boot", () => {
  test("validateBoot — every r.requires resolves", () => {
    expect(() => validateBoot(composedFeatures)).not.toThrow();
  });

  test("createRegistry succeeds + every mounted feature is queryable", () => {
    const registry = createRegistry(composedFeatures);
    for (const f of composedFeatures) {
      expect(registry.getFeature(f.name)).toBeDefined();
    }
  });

  // Descriptions feed the generated feature-reference docs — a bundled
  // feature without r.describe() would render as a bare table page.
  test("every bundled feature declares a description", () => {
    const undescribed = composedFeatures
      .filter((f) => f.description === undefined || f.description.length === 0)
      .map((f) => f.name);
    expect(undescribed).toEqual([]);
  });

  // Parity-Guard für #255: setupTestStack auto-pusht projection-/MSP-/raw-
  // Tabellen, `kumiko schema generate` liest ENTITY_METAS. Divergieren die
  // Mengen, sind Tests grün während der erste Prod-Write crasht (Tabelle
  // fehlt in den Migrations).
  test("ENTITY_METAS covers every table the test-stack would auto-push (#255)", () => {
    const generated = new Set(ENTITY_METAS.map((m) => m.tableName));
    const missing: string[] = [];
    for (const f of composedFeatures) {
      for (const { table, origin } of enumerateFeatureTableSources(f)) {
        const name = extractTableInfo(table).name;
        if (!generated.has(name)) missing.push(`${name} (${origin})`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("projection-only tables land in ENTITY_METAS (#255)", () => {
    const generated = new Set(ENTITY_METAS.map((m) => m.tableName));
    // billing-foundation registriert read_subscriptions NUR als r.projection,
    // jobs read_job_runs ebenso — vor dem Fix fehlten beide in Migrations.
    expect(generated.has("read_subscriptions")).toBe(true);
    expect(generated.has("read_job_runs")).toBe(true);
  });
});
