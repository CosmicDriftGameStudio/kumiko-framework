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
import {
  systemTenantReadDb,
  systemTenantStreamRunner,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { eraseNoteBodiesReachingSubject } from "../notes-history-user-data/index.ts";
import { collectErasureFailure, throwIfErasureFailed } from "../shared/index.ts";
import { resolveVerifiedUserEmail } from "../user/index.ts";
import { platformActor, replyExecutor, requestExecutor } from "./lib.ts";
import {
  HELPDESK_REPLY_ENTITY,
  HELPDESK_REQUEST_ENTITY,
  HELPDESK_UPLOAD_FIELD,
} from "./web/constants.ts";

const PII_DECRYPT_REASON = "helpdesk:user-data";
const ERASE_REASON = "helpdesk:user-data-forget";
const LOOKUP_LIMIT = 200;

async function findRequests(ctx: UserDataHookCtx) {
  const byUser = await requestExecutor.list(
    { filter: { field: "reporterUserId", op: "eq", value: ctx.userId }, limit: LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  const email = await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON);
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

// Attachments are copied into the system tenant and bound to the request or reply row; a tenant
// session cannot read those file_refs, so the lookup uses the system-tenant read handle.
export async function findAttachments(
  ctx: Pick<UserDataHookCtx, "db">,
  entity: string,
  id: string,
) {
  return systemTenantReadDb(ctx.db).selectMany<{
    id: string;
    storageKey: string;
    fileName: string;
  }>(fileRefsTable, {
    tenantId: SYSTEM_TENANT_ID,
    entityType: entity,
    entityId: id,
    fieldName: HELPDESK_UPLOAD_FIELD,
  });
}

export type AttachmentByteDeleter = (storageKey: string) => Promise<readonly string[]>;

// Bytes first, then the fileRef row: a crash in between leaves a row whose delete converges on the
// next run, never bytes without a row. A failing byte delete aborts, like the generic fileRef hook.
// The deleter is resolved lazily, so a row without attachments needs no storage provider.
export async function purgeAttachmentsWith(
  ctx: Pick<UserDataHookCtx, "db">,
  entity: string,
  id: string,
  resolveByteDeleter: () => Promise<AttachmentByteDeleter>,
): Promise<void> {
  const attachments = await findAttachments(ctx, entity, id);
  // skip: a row without attachments has no bytes to erase and needs no storage provider
  if (attachments.length === 0) return;
  const deleteBytes = await resolveByteDeleter();
  for (const attachment of attachments) {
    const failed = await deleteBytes(attachment.storageKey);
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

export function purgeAttachments(ctx: UserDataHookCtx, entity: string, id: string): Promise<void> {
  return purgeAttachmentsWith(ctx, entity, id, async () => {
    const provider = await ctx.buildStorageProvider?.(SYSTEM_TENANT_ID);
    if (!provider) {
      throw new InternalError({
        message: `[helpdesk:user-data] no file storage resolvable, attachments of ${entity} ${id} cannot be erased`,
      });
    }
    return (storageKey) =>
      deleteStoredFileAndDerivatives(storageKey, provider, "helpdesk:user-data");
  });
}

// Note bodies hang on the request as host. Notes written by SystemAdmins live in the system tenant,
// which a tenant-scoped hook db cannot see, so both handles are swept.
export async function eraseNotesOnRequest(
  ctx: Pick<UserDataHookCtx, "db">,
  entity: string,
  id: string,
  erasedBy: string,
): Promise<void> {
  for (const db of [ctx.db, systemTenantStreamRunner(ctx.db)]) {
    await eraseNoteBodiesReachingSubject({
      db,
      subject: { kind: "record", entity, id },
      erasedBy,
      requestId: ERASE_REASON,
    });
  }
}

// guard:dup-ok executor and foreign-key field differ; a generic executor abstraction would obscure row types.
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
    await eraseNotesOnRequest(ctx, HELPDESK_REQUEST_ENTITY, request.id, ctx.userId);
  }
  throwIfErasureFailed(failures);
};
