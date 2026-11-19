import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { deleteInboundItem } from "../delete-inbound-item.ts";
import { inboundItemExecutor } from "../schema/inbound-item.ts";

export const deleteFileWrite = defineWriteHandler({
  name: "delete-file",
  schema: z.object({ id: z.uuid() }),
  access: { roles: access.admin },
  agent: { expose: false, risk: "high" },
  description:
    "Deletes one delivered file: its bytes in the file store and its entry in the file tree. Use it for a file that should not have been uploaded; the satellite delivers it again only if it is changed.",
  handler: async (event, ctx) => {
    const item = await inboundItemExecutor.detail({ id: event.payload.id }, event.user, ctx.db);
    if (!item) return failNotFound("inbound-item", event.payload.id);
    const removed = await deleteInboundItem(ctx, event.user, {
      id: item.id,
      fileRefId: typeof item["fileRefId"] === "string" ? item["fileRefId"] : null,
    });
    if (!removed.isSuccess) return removed;
    return { isSuccess: true as const, data: { id: event.payload.id } };
  },
});
