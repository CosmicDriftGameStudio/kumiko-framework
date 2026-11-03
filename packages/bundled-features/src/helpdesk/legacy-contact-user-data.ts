import type {
  UserDataDeleteHook,
  UserDataExportHook,
  UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveVerifiedUserEmail } from "../user/index.ts";
import { eraseLegacyRequest } from "./legacy-contact-erasure.ts";
import {
  findLegacyRequestsOfSubject,
  LEGACY_CONTACT_REPLY_ENTITY,
  LEGACY_CONTACT_REQUEST_ENTITY,
  type LegacyAggregate,
  readLegacyAggregates,
  repliesOf,
} from "./legacy-contact-streams.ts";
import { findAttachments, purgeAttachments } from "./user-data-hooks.ts";

export { LEGACY_CONTACT_REPLY_ENTITY, LEGACY_CONTACT_REQUEST_ENTITY };

const PII_DECRYPT_REASON = "helpdesk:legacy-contact-user-data";

async function findLegacyRequests(ctx: UserDataHookCtx): Promise<readonly LegacyAggregate[]> {
  const email = (await resolveVerifiedUserEmail(ctx, PII_DECRYPT_REASON))?.toLowerCase();
  return findLegacyRequestsOfSubject(ctx.db, { userId: ctx.userId, email });
}

// Replies are linked by the plaintext request id, so only those of the matched requests are read.
function repliesOfRequests(ctx: UserDataHookCtx, requests: readonly LegacyAggregate[]) {
  const requestIds = new Set(requests.map((request) => request.id));
  return readLegacyAggregates(ctx.db, LEGACY_CONTACT_REPLY_ENTITY, {
    isCandidate: (raw) => typeof raw["requestId"] === "string" && requestIds.has(raw["requestId"]),
  });
}

export const legacyContactExportHook: UserDataExportHook = async (ctx) => {
  const requests = (await findLegacyRequests(ctx)).filter((request) => !request.erased);
  if (requests.length === 0) return null;
  const replies = await repliesOfRequests(ctx, requests);
  const rows = [];
  for (const request of requests) {
    const { fields } = request;
    rows.push({
      kind: fields["kind"],
      status: fields["status"],
      source: fields["source"],
      subject: fields["subject"],
      message: fields["message"],
      name: fields["name"],
      email: fields["email"],
      phone: fields["phone"],
      page: fields["page"],
      submittedAt: String(fields["submittedAt"]),
      attachments: (await findAttachments(ctx, LEGACY_CONTACT_REQUEST_ENTITY, request.id)).map(
        (file) => file.fileName,
      ),
      replies: repliesOf(replies, request.id)
        .filter((reply) => !reply.erased)
        .map((reply) => ({
          message: reply.fields["message"],
          authorName: reply.fields["authorName"],
          sentAt: String(reply.fields["sentAt"]),
        })),
    });
  }
  return { entity: LEGACY_CONTACT_REQUEST_ENTITY, rows };
};

export const legacyContactDeleteHook: UserDataDeleteHook = async (ctx) => {
  const requests = await findLegacyRequests(ctx);
  // skip: user has no pre-rename contact data to erase
  if (requests.length === 0) return;
  const replies = await repliesOfRequests(ctx, requests);
  for (const request of requests) {
    await eraseLegacyRequest(
      {
        db: ctx.db,
        erasedBy: ctx.userId,
        purgeAttachments: (entity, id) => purgeAttachments(ctx, entity, id),
      },
      request,
      repliesOf(replies, request.id),
    );
  }
};
