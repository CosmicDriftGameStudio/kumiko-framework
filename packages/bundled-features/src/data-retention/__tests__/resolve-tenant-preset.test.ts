// Unit-Test fuer die Preset-Ableitung aus dem Compliance-Profile (Layer 2).
// Der DB-gebundene "present → derive"-Pfad wird im Integrationstest
// (retention-cleanup.integration.test.ts) gegen echtes Postgres geprueft;
// hier nur die pure Map + der Soft-Gate (compliance-profiles nicht gemountet).

import { describe, expect, test } from "bun:test";
import { COMPLIANCE_PROFILES } from "@cosmicdrift/kumiko-framework/compliance";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { RETENTION_PRESETS } from "../presets";
import { PROFILE_TO_PRESET, resolveTenantRetentionPreset } from "../resolve-tenant-preset";

describe("PROFILE_TO_PRESET map", () => {
  test("deckt jeden ComplianceProfileKey ab", () => {
    for (const key of Object.keys(COMPLIANCE_PROFILES)) {
      expect(PROFILE_TO_PRESET[key as keyof typeof PROFILE_TO_PRESET]).toBeDefined();
    }
  });

  test("mappt nur auf echte RetentionPreset-Keys", () => {
    for (const preset of Object.values(PROFILE_TO_PRESET)) {
      expect(RETENTION_PRESETS[preset]).toBeDefined();
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
