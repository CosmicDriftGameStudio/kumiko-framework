import type { HandlerContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { inboundFolderAggregateId } from "./aggregate-id.ts";
import { MAX_ID_GENERATIONS } from "./constants.ts";
import { inboundFolderExecutor } from "./schema/inbound-folder.ts";

type CreateFailure = Exclude<
  Awaited<ReturnType<typeof inboundFolderExecutor.create>>,
  { readonly isSuccess: true }
>;

type FolderChainResult =
  | { readonly isSuccess: true; readonly folderId: string | null }
  | { readonly isSuccess: false; readonly error: CreateFailure["error"] };

// Creates the missing folders of a path's directory chain and returns the innermost id (null for a
// file at the device root). Ids are derived from (connector, parent, name, generation), so parallel
// uploads into a new folder race on the same stream: the loser's create conflicts and it reuses the
// winner's row. A forgotten folder leaves its stream unusable (the create conflicts with nothing to
// read) and a deleting folder takes no new files: both move on to the next generation.
// ponytail: each upload re-walks the generations of a path whose folder was deleted before, one failed create per forgotten generation; a counter on the parent would skip that.
export async function ensureFolderChain(
  connectorId: string,
  folderNames: readonly string[],
  user: SessionUser,
  db: HandlerContext["db"],
): Promise<FolderChainResult> {
  let parentId: string | null = null;
  let idPath = "/";
  for (const name of folderNames) {
    let found: string | null = null;
    let failure: CreateFailure["error"] | null = null;
    for (let generation = 0; generation < MAX_ID_GENERATIONS && found === null; generation += 1) {
      const id = inboundFolderAggregateId(connectorId, parentId, name, generation);
      const existing = await inboundFolderExecutor.detail({ id }, user, db);
      if (existing) {
        if (existing["deleting"] !== true) found = id;
        continue;
      }
      const created = await inboundFolderExecutor.create(
        { id, connectorId, parentId, name, idPath },
        user,
        db,
      );
      if (created.isSuccess || (await inboundFolderExecutor.detail({ id }, user, db))) found = id;
      else failure = created.error;
    }
    if (found === null) {
      if (failure !== null) return { isSuccess: false, error: failure };
      throw new Error(`folder "${name}" went through ${MAX_ID_GENERATIONS} generations`);
    }
    idPath = `${idPath}${found}/`;
    parentId = found;
  }
  return { isSuccess: true, folderId: parentId };
}
