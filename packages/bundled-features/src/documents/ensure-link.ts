import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { documentLinkAggregateId } from "./aggregate-id.ts";
import type { DocumentExecutors } from "./executor.ts";

export type LinkTarget = { readonly entityType: string; readonly entityId: string };

// The link id is deterministic, so a removed link is restored rather than recreated and a
// concurrent first create converges on the row the winner wrote.
export async function ensureDocumentLink(
  executors: DocumentExecutors,
  user: SessionUser,
  db: TenantDb,
  documentId: string,
  target: LinkTarget,
) {
  const id = documentLinkAggregateId(user.tenantId, documentId, target.entityType, target.entityId);
  const restored = await executors.link.restore({ id }, user, db);
  if (restored.isSuccess) return restored;
  const alreadyLive =
    isPlainObject(restored.error.details) && restored.error.details["reason"] === "not_deleted";
  if (alreadyLive) return { isSuccess: true as const, data: { id } };
  if (restored.error.code !== "not_found") return restored;

  const created = await executors.link.create(
    { id, documentId, entityType: target.entityType, entityId: target.entityId },
    user,
    db,
  );
  if (created.isSuccess || created.error.code === "version_conflict") {
    return { isSuccess: true as const, data: { id } };
  }
  return created;
}
