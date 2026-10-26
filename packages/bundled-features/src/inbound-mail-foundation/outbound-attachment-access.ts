// Who may attach a stored file to an outgoing mail: exactly who may download it. Attachments of
// imported mails are bound to the mail, so the file guard answers with the mail's visibility.

import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { isUuid } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CanReadFileRefContext,
  type FileRef,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import type { ResolveOutboundAttachmentsContext } from "./outbound-attachments.ts";

export type OutboundAttachmentAccessContext = ResolveOutboundAttachmentsContext &
  CanReadFileRefContext;

/** The file of the sender's tenant, or null: another tenant's and a deleted file read like a missing one. */
export async function loadAttachableFileRef(
  ctx: OutboundAttachmentAccessContext,
  fileRefId: string,
): Promise<FileRef | null> {
  if (!isUuid(fileRefId)) return null;
  const [fileRef] = await selectMany<FileRef>(ctx.db, fileRefsTable, {
    id: fileRefId,
    tenantId: ctx.user.tenantId,
    isDeleted: false,
  });
  return fileRef ?? null;
}
