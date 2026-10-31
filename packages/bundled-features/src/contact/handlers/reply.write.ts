import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { parseTenantId } from "@cosmicdrift/kumiko-types/identifiers";
import {
  adminAccess,
  contactDb,
  loadUserLabel,
  pickReplyChannels,
  platformActor,
  replyExecutor,
  requestExecutor,
  sendBestEffort,
} from "../lib.ts";
import { ContactReplySchema } from "../payloads.ts";
import {
  CONTACT_REPLY_CHANNELS,
  CONTACT_REPLY_ENTITY,
  CONTACT_REQUEST_ENTITY,
  CONTACT_STATUS,
  ContactErrors,
  ContactHandlers,
  type ContactReplyChannels,
  ContactScreens,
} from "../web/constants.ts";
import { takeOverUploads } from "./take-over-uploads.ts";

export type ContactReplyData = {
  readonly kind: "replied";
  readonly id: string;
  readonly status: typeof CONTACT_STATUS.Answered | typeof CONTACT_STATUS.Done;
};

type InAppNoteArgs = {
  readonly replyId: string;
  readonly request: {
    readonly id: string;
    readonly reporterUserId?: string | null | undefined;
    readonly reporterTenantId?: string | null | undefined;
    readonly locale?: string | null | undefined;
  };
  readonly authorName: string;
};

async function noteReporterInApp(ctx: HandlerContext, args: InAppNoteArgs): Promise<void> {
  const { request } = args;
  const tenantId = parseTenantId(request.reporterTenantId);
  // skip: the in-app note needs a signed-in reporter whose tenant id is still valid
  if (!request.reporterUserId || tenantId === null) return;
  await sendBestEffort(ctx, "reply in-app note", async () => {
    const noted = await ctx.dispatch.writeAs(
      createSystemUser(tenantId),
      ContactHandlers.notifyReporterInApp,
      {
        replyId: args.replyId,
        requestId: request.id,
        userId: request.reporterUserId,
        authorName: args.authorName,
        locale: request.locale ?? undefined,
      },
    );
    if (!noted.isSuccess) throw new Error(noted.error.message);
  });
}

type PersistReplyArgs = {
  readonly replyId: string;
  readonly request: {
    readonly id: string;
    readonly version: number;
    readonly replyCount?: number | null | undefined;
    readonly reporterUserId?: string | null | undefined;
  };
  readonly message: string;
  readonly authorUserId: string;
  readonly authorName: string;
  readonly fileIds: readonly string[];
  readonly channels: ContactReplyChannels;
  readonly status: ContactReplyData["status"];
};

// Returns the failing write result, or null when reply and request update both succeeded.
async function persistReply(
  ctx: HandlerContext,
  db: ReturnType<typeof contactDb>,
  args: PersistReplyArgs,
) {
  const { request } = args;
  const sentAt = ctx.tz.now();
  const createdReply = await replyExecutor.create(
    {
      id: args.replyId,
      requestId: request.id,
      ...(request.reporterUserId && { reporterUserId: request.reporterUserId }),
      message: args.message,
      authorUserId: args.authorUserId,
      authorName: args.authorName,
      ...(args.fileIds.length > 0 && { fileIds: args.fileIds }),
      channels: args.channels,
      sentAt,
    },
    platformActor(),
    db,
  );
  if (!createdReply.isSuccess) return createdReply;
  const updated = await requestExecutor.update(
    {
      id: request.id,
      version: request.version,
      changes: {
        status: args.status,
        answeredAt: sentAt,
        ...(args.status === CONTACT_STATUS.Done && { closedAt: sentAt }),
        replyCount: (request.replyCount ?? 0) + 1,
      },
    },
    platformActor(),
    db,
  );
  return updated.isSuccess ? null : updated;
}

// The drawer variant the admin used is chosen by the reply channels, and pending uploads hang under that screen.
function replyScreenFor(channels: ContactReplyChannels): string {
  return channels === CONTACT_REPLY_CHANNELS.EmailAndInApp
    ? ContactScreens.reply
    : ContactScreens.replyMail;
}

export function createReplyHandler() {
  return defineWriteHandler<"reply", typeof ContactReplySchema, ContactReplyData>({
    name: "reply",
    schema: ContactReplySchema,
    access: adminAccess,
    description:
      "A SystemAdmin answers a contact request: stores the reply (uploaded files are taken over into the system tenant), mails it to the reporter (Reply-To set, optional attachments, quoting the original request) and, for a signed-in reporter, adds an in-app note in the reporter's tenant. Marks the request answered, or done when markDone is set.",
    // The reply mail leaves the platform and cannot be recalled; reporter text may carry prompt injection.
    agent: { expose: false },
    handler: async (event, ctx) => {
      const { requestId, message, markDone } = event.payload;
      const db = contactDb(ctx);
      const request = await requestExecutor.detail({ id: requestId }, platformActor(), db);
      if (!request) return writeFailure(new NotFoundError(CONTACT_REQUEST_ENTITY, requestId));

      const replyId = generateId();
      const reporterUserId = request.reporterUserId ?? undefined;
      const channels = await pickReplyChannels(ctx, reporterUserId);
      const uploaded = await takeOverUploads(ctx, {
        user: event.user,
        screen: replyScreenFor(channels),
        entityType: CONTACT_REPLY_ENTITY,
        entityId: replyId,
        fileIds: event.payload.fileIds ?? [],
      });
      if (!uploaded.isSuccess) {
        return writeFailure(new UnprocessableError(ContactErrors.attachmentNotFound));
      }
      const fileIds = uploaded.data;
      const author = await loadUserLabel(db, event.user.id);
      const authorName = author?.name ?? event.user.id;

      const status = markDone ? CONTACT_STATUS.Done : CONTACT_STATUS.Answered;
      const failed = await persistReply(ctx, db, {
        replyId,
        request,
        message,
        authorUserId: event.user.id,
        authorName,
        fileIds,
        channels,
        status,
      });
      if (failed !== null) return failed;

      await sendBestEffort(ctx, "reply mail", async () => {
        const sent = await ctx.dispatch.writeAs(platformActor(), ContactHandlers.sendReplyMail, {
          replyId,
        });
        if (!sent.isSuccess) throw new Error(sent.error.message);
      });

      if (channels === CONTACT_REPLY_CHANNELS.EmailAndInApp) {
        await noteReporterInApp(ctx, { replyId, request, authorName });
      }

      return { isSuccess: true, data: { kind: "replied", id: replyId, status } };
    },
  });
}
