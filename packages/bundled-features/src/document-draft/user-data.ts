import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { documentDraftExecutor } from "./entity.ts";
import { DOCUMENT_DRAFT_ENTITY } from "./web/constants.ts";

// A handler ctx fits, and so does a system-mode tenant db in an erasure job.
type DraftErasureContext = { readonly db: TenantDb; readonly user: SessionUser };

const ERASE_REASON = "document-draft:subject-forget";
// Equals the executor's MAX_LIST_LIMIT.
const LIST_PAGE_SIZE = 200;

async function draftIdsOfSubject(
  ctx: DraftErasureContext,
  subject: { readonly subjectType: string; readonly subjectId: string },
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (;;) {
    const page = await documentDraftExecutor.list(
      {
        filters: [
          { field: "subjectType", op: "eq", value: subject.subjectType },
          { field: "subjectId", op: "eq", value: subject.subjectId },
        ],
        limit: LIST_PAGE_SIZE,
        offset: ids.length,
      },
      ctx.user,
      ctx.db,
    );
    ids.push(...page.rows.map((row) => String(row.id)));
    if (page.rows.length < LIST_PAGE_SIZE) return ids;
  }
}

// A draft's body, variables and last change belong to the draft's own record key, so the user
// forget run never shreds them: the app calls this when the object the drafts belong to is erased.
// The row is purged and its key erased, so the old events stay unreadable too. Without a mounted
// KMS the key erase is a no-op and the old events keep plaintext (record-owned fields are plaintext
// framework-wide, see signature user-data), so apps that need Art. 17 coverage mount one.
export async function forgetDocumentDraftsOfSubject(
  ctx: DraftErasureContext,
  subject: { readonly subjectType: string; readonly subjectId: string },
): Promise<{ readonly erased: number }> {
  const kms = configuredPiiSubjectKms();
  const ids = await draftIdsOfSubject(ctx, subject);
  for (const id of ids) {
    const forgotten = await documentDraftExecutor.forget({ id }, ctx.user, ctx.db);
    if (!forgotten.isSuccess) {
      throw new InternalError({
        message: `[document-draft] draft ${id} could not be forgotten: ${forgotten.error.message}`,
      });
    }
    // skip: no KMS adapter mounted, nothing is encrypted per record
    await kms?.eraseKey(
      { kind: "record", entity: DOCUMENT_DRAFT_ENTITY, id },
      { requestId: ERASE_REASON, userId: ctx.user.id, eraseReason: ERASE_REASON },
    );
  }
  return { erased: ids.length };
}
