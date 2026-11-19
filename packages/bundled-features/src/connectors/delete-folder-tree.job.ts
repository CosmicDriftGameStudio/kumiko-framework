import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { JobContext } from "@cosmicdrift/kumiko-framework/engine";
import { deleteInboundItem } from "./delete-inbound-item.ts";
import { inboundFolderExecutor, inboundFolderTable } from "./schema/inbound-folder.ts";
import { inboundItemTable } from "./schema/inbound-item.ts";

type FolderIds = { readonly id: string; readonly idPath: string };

// Removes the files, then the folders (deepest first) below a folder marked `deleting`, then the folder.
// Every batch re-reads what is left, so a rerun after a crash or a redelivered event carries on and ends quietly.
export async function deleteFolderTreeJob(
  _payload: unknown,
  ctx: JobContext,
  batchSize: number,
): Promise<void> {
  const folderId = ctx.triggerEvent?.aggregateId;
  if (folderId === undefined) return;
  const [root] = await selectMany<FolderIds & { connectorId: string; deleting: boolean }>(
    ctx.db,
    inboundFolderTable,
    { id: folderId },
    { fields: ["id", "idPath", "connectorId", "deleting"] },
  );
  // skip: gone already, or an update that is not a deletion request.
  if (!root?.deleting) return;

  const subtree = await selectMany<FolderIds>(
    ctx.db,
    inboundFolderTable,
    { connectorId: root.connectorId, idPath: { startsWith: `${root.idPath}${root.id}/` } },
    { fields: ["id", "idPath"] },
  );
  const folderIds = [root.id, ...subtree.map((folder) => folder.id)];
  for (;;) {
    const items = await selectMany<{ id: string; fileRefId: string | null }>(
      ctx.db,
      inboundItemTable,
      { connectorId: root.connectorId, folderId: { in: folderIds } },
      { fields: ["id", "fileRefId"], limit: batchSize },
    );
    if (items.length === 0) break;
    for (const item of items) {
      const removed = await deleteInboundItem(ctx, ctx.systemUser, item);
      if (!removed.isSuccess) throw new Error(`deleting inbound item ${item.id} failed`);
    }
  }
  const deepestFirst = [...subtree].sort((a, b) => b.idPath.length - a.idPath.length);
  for (const doomed of [...deepestFirst, root]) {
    const removed = await inboundFolderExecutor.forget({ id: doomed.id }, ctx.systemUser, ctx.db);
    if (!removed.isSuccess) throw new Error(`deleting inbound folder ${doomed.id} failed`);
  }
}
