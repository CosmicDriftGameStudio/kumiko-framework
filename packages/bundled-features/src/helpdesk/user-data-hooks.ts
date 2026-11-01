import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { deleteStoredFileAndDerivatives } from "@cosmicdrift/kumiko-framework/derivatives";
import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { fileRefEntity, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { collectErasureFailure, decryptStoredPii, throwIfErasureFailed } from "../shared/index.ts";
import { userTable } from "../user/index.ts";
import { normalizeEmail, platformActor, replyExecutor, requestExecutor } from "./lib.ts";
import {
  HELPDESK_REPLY_ENTITY,
  HELPDESK_REQUEST_ENTITY,
  HELPDESK_UPLOAD_FIELD,
} from "./web/constants.ts";

const PII_DECRYPT_REASON = "helpdesk:user-data";
const ERASE_REASON = "helpdesk:user-data-forget";
const LOOKUP_LIMIT = 200;

// Anonymous requests are matched by email, so the user must have proven they own it: otherwise
// registering with someone else's address would expose or erase that person's requests.
async function resolveVerifiedUserEmail(ctx: UserDataHookCtx): Promise<string | null> {
  const row = await ctx.db.fetchOne<{ email: string; emailVerified: boolean }>(userTable, {
    id: ctx.userId,
  });
  if (row?.emailVerified !== true) return null;
  if (ctx.userEmailBeforeDelete) return normalizeEmail(ctx.userEmailBeforeDelete);
  return normalizeEmail(await decryptStoredPii(row.email, "email", PII_DECRYPT_REASON));
}

async function findRequests(ctx: UserDataHookCtx) {
  const byUser = await requestExecutor.list(
    { filter: { field: "reporterUserId", op: "eq", value: ctx.userId }, limit: LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  const email = await resolveVerifiedUserEmail(ctx);
  const byEmail = email
    ? await requestExecutor.list(
        { filter: { field: "email", op: "eq", value: email }, limit: LOOKUP_LIMIT },
        platformActor(),
        ctx.db,
      )
    : { rows: [] };
  const unique = new Map(byUser.rows.map((row) => [row.id, row]));
  for (const row of byEmail.rows) unique.set(row.id, row);
  return [...unique.values()];
}

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

// Attachments are copied into the system tenant and bound to the request or reply row.
async function findAttachments(ctx: UserDataHookCtx, entity: string, id: string) {
  return ctx.db.selectMany<{ id: string; storageKey: string; fileName: string }>(fileRefsTable, {
    tenantId: SYSTEM_TENANT_ID,
    entityType: entity,
    entityId: id,
    fieldName: HELPDESK_UPLOAD_FIELD,
  });
}

// Bytes first, then the fileRef row: a crash in between leaves a row whose delete converges on the
// next run, never bytes without a row. A failing byte delete aborts, like the generic fileRef hook.
async function purgeAttachments(ctx: UserDataHookCtx, entity: string, id: string): Promise<void> {
  const attachments = await findAttachments(ctx, entity, id);
  // skip: a row without attachments has no bytes to erase and needs no storage provider
  if (attachments.length === 0) return;
  const provider = await ctx.buildStorageProvider?.(SYSTEM_TENANT_ID);
  if (!provider) {
    throw new InternalError({
      message: `[helpdesk:user-data] no file storage resolvable, attachments of ${entity} ${id} cannot be erased`,
    });
  }
  for (const attachment of attachments) {
    const failed = await deleteStoredFileAndDerivatives(
      attachment.storageKey,
      provider,
      "helpdesk:user-data",
    );
    if (failed.length > 0) {
      throw new InternalError({
        message: `[helpdesk:user-data] ${failed.length} attachment byte delete(s) failed for ${entity} ${id}`,
      });
    }
  }
  const failures: string[] = [];
  for (const attachment of attachments) {
    collectErasureFailure(
      await fileRefExecutor.forget({ id: attachment.id }, platformActor(), ctx.db),
      "fileRef",
      attachment.id,
      failures,
    );
  }
  throwIfErasureFailed(failures);
}

async function findReplies(ctx: UserDataHookCtx, requestId: string) {
  const found = await replyExecutor.list(
    { filter: { field: "requestId", op: "eq", value: requestId }, limit: LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  return found.rows;
}

export const helpdeskExportHook: UserDataExportHook = async (ctx) => {
  const requests = await findRequests(ctx);
  if (requests.length === 0) return null;
  const rows = [];
  for (const request of requests) {
    const replies = await findReplies(ctx, request.id);
    rows.push({
      kind: request.kind,
      status: request.status,
      source: request.source,
      subject: request.subject,
      message: request.message,
      name: request.name,
      email: request.email,
      phone: request.phone,
      page: request.page,
      submittedAt: String(request.submittedAt),
      attachments: (await findAttachments(ctx, HELPDESK_REQUEST_ENTITY, request.id)).map(
        (file) => file.fileName,
      ),
      replies: replies.map((reply) => ({
        message: reply.message,
        authorName: reply.authorName,
        sentAt: String(reply.sentAt),
      })),
    });
  }
  return { entity: HELPDESK_REQUEST_ENTITY, rows };
};

// Requests and replies carry no statutory retention duty, so both strategies erase: rows are
// purged through the executor (replays on rebuild) and the record subject keys are shredded so
// the event log's ciphertext becomes unreadable. Replies go with their request.
export const helpdeskDeleteHook: UserDataDeleteHook = async (ctx) => {
  const kms = configuredPiiSubjectKms();
  const failures: string[] = [];
  const erase = async (
    entity: string,
    id: string,
    forgotten: Parameters<typeof collectErasureFailure>[0],
  ) => {
    collectErasureFailure(forgotten, entity, id, failures);
    if (forgotten.isSuccess && kms) {
      await kms.eraseKey(
        { kind: "record", entity, id },
        { requestId: ERASE_REASON, userId: ctx.userId, eraseReason: ERASE_REASON },
      );
    }
  };
  for (const request of await findRequests(ctx)) {
    for (const reply of await findReplies(ctx, request.id)) {
      await purgeAttachments(ctx, HELPDESK_REPLY_ENTITY, reply.id);
      await erase(
        HELPDESK_REPLY_ENTITY,
        reply.id,
        await replyExecutor.forget({ id: reply.id }, platformActor(), ctx.db),
      );
    }
    await purgeAttachments(ctx, HELPDESK_REQUEST_ENTITY, request.id);
    await erase(
      HELPDESK_REQUEST_ENTITY,
      request.id,
      await requestExecutor.forget({ id: request.id }, platformActor(), ctx.db),
    );
  }
  throwIfErasureFailed(failures);
};
