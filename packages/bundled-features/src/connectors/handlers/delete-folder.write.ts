import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { inboundFolderExecutor } from "../schema/inbound-folder.ts";

export const deleteFolderWrite = defineWriteHandler({
  name: "delete-folder",
  schema: z.object({ id: z.uuid() }),
  access: { roles: access.admin },
  agent: { expose: false, risk: "high" },
  description:
    "Deletes a folder of the file tree with every file and subfolder below it, bytes included, however many. The folder is marked at once (shown as being deleted, no longer counted against the quota); the `delete-folder-tree` job removes the contents in the background.",
  handler: async (event, ctx) => {
    const folder = await inboundFolderExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
    if (!folder) return failNotFound("inbound-folder", event.payload.id);
    // The job is on its way already; a second click must not queue another sweep.
    if (folder["deleting"] === true) return { isSuccess: true as const, data: { id: folder.id } };
    const marked = await inboundFolderExecutor.update(
      { id: folder.id, version: folder.version, changes: { deleting: true } },
      event.user,
      ctx.db,
    );
    if (!marked.isSuccess) return marked;
    return { isSuccess: true as const, data: { id: folder.id } };
  },
});
