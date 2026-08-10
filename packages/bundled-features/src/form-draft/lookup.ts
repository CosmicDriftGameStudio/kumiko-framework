import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftTable } from "./executor";
import type { FormDraftBlob } from "./schemas";

export type FormDraftRow = {
  readonly id: string;
  readonly draft: FormDraftBlob;
};

// Shared by save (upsert lookup + race re-lookup), discard, and get — always
// scoped by tenantId + ownerId + draftKey, tenantId included explicitly
// (not relying on TenantDb auto-scoping) to mirror delivery/upsert-preference.ts.
export async function lookupDraft(
  db: TenantDb,
  tenantId: TenantId,
  ownerId: string,
  draftKey: string,
): Promise<FormDraftRow | undefined> {
  return fetchOne<FormDraftRow>(db, formDraftTable, { tenantId, ownerId, draftKey });
}
