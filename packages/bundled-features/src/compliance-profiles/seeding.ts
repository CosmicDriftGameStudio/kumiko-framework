// Test helper for compliance-profiles. Creates a profile entry directly
// through the Event Store executor—the same path as the real
// set-profile handler, but without Zod schema restrictions (accepts
// minimal-no-region for migration edge-case tests) and without an access
// check. Default ifExists="skip": creates only missing profiles.
//
// user-data-rights uses this for test setup ("user can export data with
// profile X": a fresh tenant and profile selection per test in one helper
// call).
//
// The pattern matches seedTextBlock in template-resolver/seeding.ts.

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
import {
  createSystemUser,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { runEventStoreSeed, type SeedIfExists } from "@cosmicdrift/kumiko-framework/seeding";

import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "./schema/profile-selection.ts";

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
  readonly ifExists?: SeedIfExists;
};

export async function seedComplianceProfile(
  db: DbConnection,
  opts: SeedComplianceProfileOptions,
): Promise<{ id: string }> {
  // user.tenantId must equal opts.tenantId so the Event Store stream
  // and projection remain in the same tenant bucket.
  const by = opts.by ?? createSystemUser(opts.tenantId);
  const tdb = createTenantDb({
    db,
    tenantId: opts.tenantId,
    mode: "system",
    reason: "seeding writes the compliance profile into an explicitly named tenant",
  });
  const overrideJson = opts.override !== undefined ? JSON.stringify(opts.override) : null;

  const existing = (await fetchOne(db, tenantComplianceProfileTable, {
    tenantId: opts.tenantId,
  })) as { id: string; version: number } | null; // @cast-boundary db-runner

  return runEventStoreSeed({
    existing,
    ifExists: opts.ifExists,
    create: async () => {
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
      // @cast-boundary db-row: executor.create result.data is the
      // inserted projection row (Record<string, unknown>); id is guaranteed
      // after INSERT (runtime check directly below).
      const data = result.data as { id?: string };
      if (data.id === undefined) {
        throw new Error("seedComplianceProfile: executor.create did not return an id");
      }
      return { id: data.id };
    },
    update: async (row) => {
      const result = await executor.update(
        {
          id: row.id,
          version: row.version,
          changes: { profileKey: opts.profileKey, override: overrideJson },
        },
        by,
        tdb,
      );
      if (!result.isSuccess) {
        throw new Error(`seedComplianceProfile update failed: ${JSON.stringify(result)}`);
      }
      return { id: row.id };
    },
  });
}
