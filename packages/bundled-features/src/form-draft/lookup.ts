import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { formDraftTable } from "./executor";
import type { FormDraftBlob } from "./schemas";

export type FormDraftRow = {
  readonly id: string;
  readonly version: number;
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

export type FormDraftSummaryRow = {
  readonly id: string;
  readonly draftKey: string;
  readonly draft: FormDraftBlob;
};

// LIKE metacharacters in a caller-controlled screenId must not widen the
// prefix scan (e.g. a literal "%" matching every draft).
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// draftKey is `${screenId}:${entityId}` or `${screenId}:new:${draftId}`
// (framework-wizard-mode.md) — "drafts for a screenId" is a LIKE prefix
// match on that leading segment. tenantId + ownerId equality narrows to the
// caller's own rows via the (tenantId, ownerId, draftKey) unique index
// before the pattern filter applies.
export async function listDraftsByScreen(
  db: TenantDb,
  tenantId: TenantId,
  ownerId: string,
  screenId: string,
): Promise<readonly FormDraftSummaryRow[]> {
  return selectMany<FormDraftSummaryRow>(db, formDraftTable, {
    tenantId,
    ownerId,
    draftKey: { like: `${escapeLikePattern(screenId)}:%` },
  });
}
