import type { HandlerContext, JobContext, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { purgeFileRef } from "@cosmicdrift/kumiko-framework/files";
import { inboundItemExecutor } from "./schema/inbound-item.ts";

// Bytes first (purgeFileRef), then the item's event stream; forget so the encrypted path is gone as well.
export async function deleteInboundItem(
  ctx: Pick<HandlerContext, "db" | "services"> | Pick<JobContext, "db" | "services">,
  user: SessionUser,
  item: { readonly id: string; readonly fileRefId: string | null },
) {
  if (item.fileRefId)
    await purgeFileRef({ db: ctx.db, user, files: ctx.services.files }, item.fileRefId);
  return inboundItemExecutor.forget({ id: item.id }, user, ctx.db);
}
