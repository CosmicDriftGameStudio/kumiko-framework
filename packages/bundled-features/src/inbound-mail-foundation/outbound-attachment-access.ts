// Who may attach a stored file to an outgoing mail. The decision is the one for downloading the file,
// plus one domain rule: an imported mail attachment is not bound to any record and was stored by the
// system identity, so the file guard alone would refuse it for everyone.

import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { isUuid, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CanReadFileRefContext,
  canCallerReadFileRef,
  type FileRef,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import type { MailAccountRow } from "./account-record.ts";
import { isVisibleToCaller } from "./handlers/scope-visibility.ts";
import type { ResolveOutboundAttachmentsContext } from "./outbound-attachments.ts";
import { inboundMessagesProjectionTable, mailAccountsProjectionTable } from "./projection.ts";

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

// The id is a uuid, so the quoted pattern cannot match a longer id or carry LIKE wildcards.
async function isAttachmentOfVisibleInboundMessage(
  ctx: OutboundAttachmentAccessContext,
  fileRef: FileRef,
): Promise<boolean> {
  const isUnboundSystemFile =
    fileRef.entityType === null &&
    fileRef.entityId === null &&
    fileRef.insertedById === SYSTEM_USER_ID;
  if (!isUnboundSystemFile) return false;
  const messages = await ctx.db.selectMany(inboundMessagesProjectionTable, {
    tenantId: ctx.user.tenantId,
    attachmentFileIds: { like: `%"${fileRef.id}"%` },
  });
  const accountIds = [...new Set(messages.map((message) => String(message["accountId"])))];
  for (const accountId of accountIds) {
    const account = await fetchOne<MailAccountRow>(ctx.db, mailAccountsProjectionTable, {
      id: accountId,
      tenantId: ctx.user.tenantId,
    });
    if (account && isVisibleToCaller(account, ctx.user)) return true;
  }
  return false;
}

export async function mayAttachFileRef(
  ctx: OutboundAttachmentAccessContext,
  fileRef: FileRef,
): Promise<boolean> {
  if (await isAttachmentOfVisibleInboundMessage(ctx, fileRef)) return true;
  return canCallerReadFileRef(ctx, fileRef);
}
