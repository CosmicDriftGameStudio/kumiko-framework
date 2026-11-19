import type { PreSaveHookFn } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { folderExecutor } from "./executor.ts";
import { FOLDER_LOCK_NAMESPACE } from "./web/constants.ts";

// A folder id never equals this key, so the tenant-wide reparent lock cannot collide with a folder lock.
const REPARENT_LOCK_KEY = "reparent";

function folderIdOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

// read_folders has no FK on parentId, so the parent is checked here: it must be a live folder of
// the tenant, and a moved folder must not land under itself or one of its descendants. The parent
// lock serialises with folder:delete; the tenant-wide reparent lock keeps two concurrent moves
// from building a cycle together.
export const rejectInvalidFolderParent: PreSaveHookFn = async (changes, ctx) => {
  if (!("parentId" in changes)) return changes;
  const parentId = folderIdOrNull(changes["parentId"]);
  if (parentId === null) return changes;
  const movedId = ctx.isNew ? null : folderIdOrNull(ctx.previous["id"]);
  if (movedId !== null) await ctx.db.advisoryXactLock(FOLDER_LOCK_NAMESPACE, REPARENT_LOCK_KEY);
  await ctx.db.advisoryXactLock(FOLDER_LOCK_NAMESPACE, parentId);

  const visited = new Set<string>();
  let ancestorId: string | null = parentId;
  while (ancestorId !== null && !visited.has(ancestorId)) {
    if (ancestorId === movedId) {
      throw new UnprocessableError("folder_parent_cycle", {
        details: { folderId: movedId, parentId },
      });
    }
    visited.add(ancestorId);
    const ancestor = await folderExecutor.detail({ id: ancestorId }, ctx.user, ctx.db);
    if (!ancestor) {
      if (ancestorId === parentId) {
        throw new UnprocessableError("folder_parent_not_found", { details: { parentId } });
      }
      // A dangling ancestor renders at the root (folders-view), so the chain ends here.
      break;
    }
    ancestorId = folderIdOrNull(ancestor["parentId"]);
  }
  return changes;
};
