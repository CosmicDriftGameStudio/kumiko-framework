import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { collectErasureFailure, throwIfErasureFailed } from "../shared/index.ts";
import { resolveVerifiedUserEmail } from "../user/index.ts";
import { helpdeskReplyEntity, helpdeskRequestEntity } from "./entity.ts";
import { platformActor } from "./lib.ts";
import { findAttachments, purgeAttachments } from "./user-data-hooks.ts";

// Data stored before the contact -> helpdesk rename stays under the old aggregate names and
// tables. The old entities are only used to read and forget those rows, never registered, so no
// schema is generated for them.
export const LEGACY_CONTACT_REQUEST_ENTITY = "contact-request";
export const LEGACY_CONTACT_REPLY_ENTITY = "contact-reply";

const PII_DECRYPT_REASON = "helpdesk:legacy-contact-user-data";
const ERASE_REASON = "helpdesk:legacy-contact-user-data-forget";
const LOOKUP_LIMIT = 200;

const legacyRequestEntity = { ...helpdeskRequestEntity, table: "read_contact_requests" };
const legacyReplyEntity = { ...helpdeskReplyEntity, table: "read_contact_replies" };

const legacyRequestExecutor = createEventStoreExecutor(
  buildEntityTable(LEGACY_CONTACT_REQUEST_ENTITY, legacyRequestEntity),
  legacyRequestEntity,
  { entityName: LEGACY_CONTACT_REQUEST_ENTITY },
);
const legacyReplyExecutor = createEventStoreExecutor(
  buildEntityTable(LEGACY_CONTACT_REPLY_ENTITY, legacyReplyEntity),
  legacyReplyEntity,
  { entityName: LEGACY_CONTACT_REPLY_ENTITY },
);

// The read tables are absent on installs that never ran the contact feature, and querying a
// missing table would abort the surrounding transaction. The event log is always present, and
// the read tables were created together with the first contact event.
async function hasLegacyContactData(ctx: UserDataHookCtx): Promise<boolean> {
  const firstEvent = await ctx.db.fetchOne(eventsTable, {
    aggregateType: LEGACY_CONTACT_REQUEST_ENTITY,
  });
  return firstEvent !== undefined;
}

async function findLegacyRequests(ctx: UserDataHookCtx) {
  const byUser = await legacyRequestExecutor.list(
    { filter: { field: "reporterUserId", op: "eq", value: ctx.userId }, limit: LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  const email = await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON);
  const byEmail = email
    ? await legacyRequestExecutor.list(
        { filter: { field: "email", op: "eq", value: email }, limit: LOOKUP_LIMIT },
        platformActor(),
        ctx.db,
      )
    : { rows: [] };
  const unique = new Map(byUser.rows.map((row) => [row.id, row]));
  for (const row of byEmail.rows) unique.set(row.id, row);
  return [...unique.values()];
}

async function findLegacyReplies(ctx: UserDataHookCtx, requestId: string) {
  const found = await legacyReplyExecutor.list(
    { filter: { field: "requestId", op: "eq", value: requestId }, limit: LOOKUP_LIMIT },
    platformActor(),
    ctx.db,
  );
  return found.rows;
}

export const legacyContactExportHook: UserDataExportHook = async (ctx) => {
  if (!(await hasLegacyContactData(ctx))) return null;
  const requests = await findLegacyRequests(ctx);
  if (requests.length === 0) return null;
  const rows = [];
  for (const request of requests) {
    const replies = await findLegacyReplies(ctx, request.id);
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
      attachments: (await findAttachments(ctx, LEGACY_CONTACT_REQUEST_ENTITY, request.id)).map(
        (file) => file.fileName,
      ),
      replies: replies.map((reply) => ({
        message: reply.message,
        authorName: reply.authorName,
        sentAt: String(reply.sentAt),
      })),
    });
  }
  return { entity: LEGACY_CONTACT_REQUEST_ENTITY, rows };
};

export const legacyContactDeleteHook: UserDataDeleteHook = async (ctx) => {
  // skip: user has no pre-rename contact data to erase
  if (!(await hasLegacyContactData(ctx))) return;
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
  for (const request of await findLegacyRequests(ctx)) {
    for (const reply of await findLegacyReplies(ctx, request.id)) {
      await purgeAttachments(ctx, LEGACY_CONTACT_REPLY_ENTITY, reply.id);
      await erase(
        LEGACY_CONTACT_REPLY_ENTITY,
        reply.id,
        await legacyReplyExecutor.forget({ id: reply.id }, platformActor(), ctx.db),
      );
    }
    await purgeAttachments(ctx, LEGACY_CONTACT_REQUEST_ENTITY, request.id);
    await erase(
      LEGACY_CONTACT_REQUEST_ENTITY,
      request.id,
      await legacyRequestExecutor.forget({ id: request.id }, platformActor(), ctx.db),
    );
  }
  throwIfErasureFailed(failures);
};
