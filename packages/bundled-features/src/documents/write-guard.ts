import {
  type DeleteContext,
  type HandlerContext,
  type PreSaveHookFn,
  SYSTEM_ROLE,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { DOCUMENT_ENTITY } from "./constants.ts";
import type { DocumentExecutors } from "./executor.ts";
import { canWriteLinkTarget } from "./target-write-check.ts";

const LINK_PAGE_SIZE = 200;

// Editing or deleting a document changes what every reader of its hosts sees, so it needs what
// unlink needs: write access to at least one host it is linked to. Admin roles see unlinked
// documents too and must be able to clean them up, and SYSTEM jobs (import, capture) write on
// their own authority. A refused caller gets "not found", like a document they cannot read.
export function createDocumentWriteGuard(
  executors: DocumentExecutors,
  adminRoles: readonly string[],
) {
  async function assertMayWrite(documentId: string, ctx: HandlerContext): Promise<void> {
    const { user } = ctx;
    if (user.roles.includes(SYSTEM_ROLE) || user.roles.some((role) => adminRoles.includes(role))) {
      // skip: exempt roles write on their own authority
      return;
    }
    let offset = 0;
    for (;;) {
      const page = await executors.link.list(
        {
          filters: [{ field: "documentId", op: "eq", value: documentId }],
          limit: LINK_PAGE_SIZE,
          offset,
        },
        user,
        ctx.db,
      );
      for (const row of page.rows) {
        const entityType = String(row["entityType"]);
        const entityId = String(row["entityId"]);
        // skip: one writable host is enough
        if (await canWriteLinkTarget(ctx.registry, entityType, entityId, user, ctx.db)) return;
      }
      if (page.rows.length < LINK_PAGE_SIZE) break;
      offset += LINK_PAGE_SIZE;
    }
    throw new NotFoundError(DOCUMENT_ENTITY, documentId);
  }

  const beforeUpdate: PreSaveHookFn = async (changes, ctx) => {
    if (!ctx.isNew) await assertMayWrite(String(ctx.previous["id"]), ctx);
    return changes;
  };
  const beforeDelete = async (payload: DeleteContext, ctx: HandlerContext): Promise<void> => {
    await assertMayWrite(String(payload.id), ctx);
  };
  return { beforeUpdate, beforeDelete };
}
