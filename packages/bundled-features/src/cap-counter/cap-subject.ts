import { computeBlindIndex, configuredBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { type DbRunner, deleteMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import * as z from "zod";
import { CAP_COUNTER_FEATURE } from "./constants.ts";
import { capCountersTable, capReservationsTable } from "./tables.ts";

export type CapSubject = { readonly key: string; readonly share?: number };

// The primary key column is NOT NULL, so the tenant-wide row cannot use NULL.
export const TENANT_WIDE_SUBJECT_HASH = "";

export const capSubjectSchema = z.object({
  key: z.string().min(1).max(500),
  share: z.number().gt(0).lte(1).optional(),
});

export function capSubjectHash(subjectKey: string): string {
  const key = configuredBlindIndexKey();
  if (key === undefined) {
    throw new Error(
      "cap-counter: a subject cap needs the blind index key (KUMIKO_BLIND_INDEX_KEY) so the subject key is stored only as an HMAC",
    );
  }
  return computeBlindIndex(key, `cap-subject:${subjectKey}`);
}

export function capSubjectLimit(limit: number, share: number): number {
  return Math.floor(limit * share);
}

export async function forgetCapCounterSubject(
  db: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  subjectKey: string,
): Promise<void> {
  if (!features.has(CAP_COUNTER_FEATURE)) return;
  // Without a key no subject row can have been written.
  if (configuredBlindIndexKey() === undefined) return;
  const subjectHash = capSubjectHash(subjectKey);
  await runInSystemRowLevelSecurityScope(
    "cap counter rows of a forgotten subject span tenants",
    async () => {
      await deleteMany(db, capCountersTable, { subjectHash });
      await updateMany(db, capReservationsTable, { subjectHash: null }, { subjectHash });
    },
  );
}
