// Test-Helper für compliance-profiles. Legt einen Profile-Eintrag direkt
// über den Event-Store-Executor an — gleicher Pfad wie der echte
// set-profile-Handler, aber ohne Zod-Schema-Engung (akzeptiert
// minimal-no-region für Migration-Edge-Case-Tests) und ohne Access-
// Check. Idempotent: zweiter Call mit gleichem tenantId updated.
//
// Sprint 2 user-data-rights nutzt das fuer Test-Setup ("user kann
// Daten exportieren mit profile X" — pro Test ein frischer Tenant +
// Profile-Wahl in einem Helper-Call).
//
// Pattern matched seedTextBlock aus text-content.

import type {
  ComplianceProfileKey,
  ComplianceProfileOverride,
} from "@cosmicdrift/kumiko-framework/compliance";
import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "./schema/profile-selection";

const executor = createEventStoreExecutor(
  tenantComplianceProfileTable,
  tenantComplianceProfileEntity,
  { entityName: "tenant-compliance-profile" },
);

export type SeedComplianceProfileOptions = {
  readonly tenantId: TenantId;
  readonly profileKey: ComplianceProfileKey;
  readonly override?: ComplianceProfileOverride;
  readonly by?: SessionUser;
};

export async function seedComplianceProfile(
  db: DbConnection,
  opts: SeedComplianceProfileOptions,
): Promise<{ id: string | number }> {
  // user.tenantId muss === opts.tenantId sein damit Event-Store-Stream
  // + Projection im selben Tenant-Bucket landen (Memory:
  // feedback_event_store_tenant_consistency).
  const by = opts.by ?? { ...TestUsers.systemAdmin, tenantId: opts.tenantId };
  const tdb = createTenantDb(db, opts.tenantId, "system");
  const overrideJson = opts.override !== undefined ? JSON.stringify(opts.override) : null;

  const existing = (await fetchOne(
    db,
    tenantComplianceProfileTable,
    { tenantId: opts.tenantId },
  )) as { id: string; version: number } | null; // @cast-boundary db-runner

  if (existing) {
    const result = await executor.update(
      {
        id: existing.id,
        version: existing.version,
        changes: { profileKey: opts.profileKey, override: overrideJson },
      },
      by,
      tdb,
    );
    if (!result.isSuccess) {
      throw new Error(`seedComplianceProfile update failed: ${JSON.stringify(result)}`);
    }
    return { id: existing.id };
  }

  const result = await executor.create(
    {
      profileKey: opts.profileKey,
      override: overrideJson,
      tenantId: opts.tenantId,
    },
    by,
    tdb,
  );
  if (!result.isSuccess) {
    throw new Error(`seedComplianceProfile create failed: ${JSON.stringify(result)}`);
  }
  // @cast-boundary db-row: executor.create-result enthält die inserted
  // Row als Record<string, unknown>; id ist nach INSERT garantiert.
  const data = result.data as { id?: string };
  if (data.id === undefined) {
    throw new Error("seedComplianceProfile: executor.create did not return an id");
  }
  return { id: data.id };
}
