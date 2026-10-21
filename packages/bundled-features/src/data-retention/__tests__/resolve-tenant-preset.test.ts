// Unit test for deriving the preset from the compliance profile (Layer 2).
// The database-backed "present → derive" path is tested against real Postgres
// in the integration test (retention-cleanup.integration.test.ts);
// this covers only the pure map and the soft gate (compliance-profiles not mounted).

import { describe, expect, test } from "bun:test";
import { COMPLIANCE_PROFILES } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { RETENTION_PRESETS } from "../presets.ts";
import { PROFILE_TO_PRESET, resolveTenantRetentionPreset } from "../resolve-tenant-preset.ts";

describe("PROFILE_TO_PRESET map", () => {
  test("deckt jeden ComplianceProfileKey ab", () => {
    for (const key of Object.keys(COMPLIANCE_PROFILES)) {
      expect(typeof PROFILE_TO_PRESET[key as keyof typeof PROFILE_TO_PRESET]).toBe("string");
    }
  });

  test("mappt nur auf echte RetentionPreset-Keys", () => {
    for (const preset of Object.values(PROFILE_TO_PRESET)) {
      expect(Object.keys(RETENTION_PRESETS)).toContain(preset);
    }
  });

  test("swiss-dsg ist namensgleich, EU/DE mappen auf ihr Regime", () => {
    expect(PROFILE_TO_PRESET["swiss-dsg"]).toBe("swiss-dsg");
    expect(PROFILE_TO_PRESET["eu-dsgvo"]).toBe("dsgvo-basic");
    expect(PROFILE_TO_PRESET["de-hr-dsgvo-hgb"]).toBe("dsgvo-hgb");
    expect(PROFILE_TO_PRESET["minimal-no-region"]).toBe("default");
  });
});

describe("resolveTenantRetentionPreset soft-gate", () => {
  test("compliance-profiles nicht gemountet → null (ohne DB-Zugriff)", async () => {
    let dbTouched = false;
    const db = new Proxy(
      {},
      {
        get() {
          dbTouched = true;
          throw new Error("DB must not be touched when compliance-profiles is absent");
        },
      },
    ) as unknown as DbRunner;
    const registry = { getEntity: () => undefined } as unknown as Registry;

    const preset = await resolveTenantRetentionPreset({
      db,
      registry,
      tenantId: "t1" as TenantId,
    });

    expect(preset).toBeNull();
    expect(dbTouched).toBe(false);
  });
});
