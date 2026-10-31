import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type HandlerContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import type { FileAttachmentRef } from "../../delivery/index.ts";
import { decryptStoredPii } from "../../shared/index.ts";
import {
  contactDb,
  internalAccess,
  loadUserLabel,
  platformActor,
  replyExecutor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { contactReplyVariables, resolveContactMailLocale } from "../mail.ts";
import type { ContactOptions } from "../options.ts";
import { ContactSendReplyMailSchema } from "../payloads.ts";
import {
  CONTACT_NOTIFICATION_TYPES,
  CONTACT_REPLY_ENTITY,
  CONTACT_REQUEST_ENTITY,
  ContactConfigKeys,
  contactIdempotencyKeys,
} from "../web/constants.ts";

const ATTACHMENT_LOOKUP_REASON = "contact:reply-attachment";

export type ContactSendReplyMailData = { readonly kind: "sent"; readonly attachmentCount: number };

type FileRefNameRow = { readonly fileName: string };

async function resolveAttachments(
  ctx: HandlerContext,
  fileIds: readonly string[],
): Promise<readonly FileAttachmentRef[]> {
  const db = contactDb(ctx);
  const attachments: FileAttachmentRef[] = [];
  for (const fileRefId of fileIds) {
    const row = await fetchOne<FileRefNameRow>(db, fileRefsTable, {
      id: fileRefId,
      tenantId: SYSTEM_TENANT_ID,
    });
    // skip: a file that vanished since the reply was stored cannot be attached
    if (!row) continue;
    const fileName = await decryptStoredPii(row.fileName, "fileName", ATTACHMENT_LOOKUP_REASON);
    attachments.push({ kind: "file", fileRefId, fileName });
  }
  return attachments;
}

async function resolveReplyTo(
  ctx: HandlerContext,
  authorEmail: string | undefined,
): Promise<string | undefined> {
  const configured = await ctx.config?.(ContactConfigKeys.replyTo);
  return typeof configured === "string" && configured.trim() !== ""
    ? configured.trim()
    : authorEmail;
}

// Runs as the platform identity: the delivery channel reads attachments of the sending tenant,
// and the reply files live in the system tenant, whichever tenant the answering admin is in.
export function createSendReplyMailHandler(opts: ContactOptions) {
  return defineWriteHandler<
    "send-reply-mail",
    typeof ContactSendReplyMailSchema,
    ContactSendReplyMailData
  >({
    name: "send-reply-mail",
    schema: ContactSendReplyMailSchema,
    access: internalAccess,
    agent: { expose: false },
    description:
      "Internal: mails a stored reply to the reporter with Reply-To, the quoted request and the reply files attached. Only the platform identity can call it.",
    handler: async (event, ctx) => {
      const db = contactDb(ctx);
      const { replyId } = event.payload;
      const reply = await replyExecutor.detail({ id: replyId }, platformActor(), db);
      if (!reply) return writeFailure(new NotFoundError(CONTACT_REPLY_ENTITY, replyId));
      const request = await requestExecutor.detail({ id: reply.requestId }, platformActor(), db);
      if (!request) {
        return writeFailure(new NotFoundError(CONTACT_REQUEST_ENTITY, reply.requestId));
      }

      const author = await loadUserLabel(db, reply.authorUserId);
      const reporterUserId = request.reporterUserId ?? undefined;
      const reporter = reporterUserId ? await loadUserLabel(db, reporterUserId) : null;
      const recipientEmail = reporter?.email ?? request.email;
      const replyTo = await resolveReplyTo(ctx, author?.email ?? undefined);
      const attachments = await resolveAttachments(ctx, reply.fileIds ?? []);
      const locale = request.locale ?? undefined;

      await sendBestEffort(ctx, "reply mail", (notify) =>
        notify(CONTACT_NOTIFICATION_TYPES.reply, {
          route: { email: recipientEmail },
          recipientId: request.id,
          data: {
            ...contactReplyVariables({
              requestSubject: request.subject,
              requestMessage: request.message,
              requestSubmittedAt: Number(request.submittedAt.epochMilliseconds),
              replyMessage: reply.message,
              authorName: reply.authorName,
              appName: opts.appName,
              locale,
            }),
            ...(replyTo !== undefined && { replyTo }),
            ...(attachments.length > 0 && { attachments }),
          },
          idempotencyKey: contactIdempotencyKeys.reply(replyId),
          priority: "normal",
          locale: resolveContactMailLocale(locale),
        }),
      );

      return { isSuccess: true, data: { kind: "sent", attachmentCount: attachments.length } };
    },
  });
}
