import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { parseTenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  adminAccess,
  contactDb,
  listRepliesOf,
  loadUserLabel,
  platformActor,
  requestExecutor,
} from "../lib.ts";
import type { ContactOptions } from "../options.ts";
import { ContactIdSchema } from "../payloads.ts";
import {
  CONTACT_DELIVERY_CHANNEL,
  CONTACT_DELIVERY_STATUS,
  CONTACT_REQUEST_ENTITY,
  ContactConfigKeys,
  type ContactDeliveryChannel,
  type ContactDeliveryStatus,
  contactIdempotencyKeys,
} from "../web/constants.ts";
import { type ContactAttempt, loadAttemptsByKey, loadReadAtByKey } from "./attempts.ts";

type DeliveryRow = {
  readonly id: string;
  readonly channel: ContactDeliveryChannel;
  readonly recipient: string;
  readonly at: string;
  readonly status: ContactDeliveryStatus;
};

function displayStatus(attemptStatus: string): ContactDeliveryStatus {
  switch (attemptStatus) {
    case "sent":
      return CONTACT_DELIVERY_STATUS.Delivered;
    case "failed":
      return CONTACT_DELIVERY_STATUS.Failed;
    case "skipped":
      return CONTACT_DELIVERY_STATUS.Skipped;
    default:
      return CONTACT_DELIVERY_STATUS.Pending;
  }
}

function attemptsOf(attempts: readonly ContactAttempt[], key: string): readonly ContactAttempt[] {
  return attempts.filter((attempt) => attempt.key === key);
}

function rowOf(
  attempt: ContactAttempt,
  channel: ContactDeliveryChannel,
  recipient: string,
  readAt: Temporal.Instant | null | undefined,
): DeliveryRow {
  const read = readAt !== undefined && readAt !== null;
  return {
    id: `${attempt.key}:${attempt.channel}:${attempt.recipientId ?? ""}`,
    channel,
    recipient,
    at: (read ? readAt : attempt.createdAt).toString(),
    status: read ? CONTACT_DELIVERY_STATUS.Read : displayStatus(attempt.status),
  };
}

async function adminRows(
  db: TenantDb,
  attempts: readonly ContactAttempt[],
  requestId: string,
): Promise<readonly DeliveryRow[]> {
  const rows: DeliveryRow[] = [];
  for (const attempt of attemptsOf(attempts, contactIdempotencyKeys.admins(requestId))) {
    const admin = attempt.recipientId ? await loadUserLabel(db, attempt.recipientId) : null;
    rows.push(
      rowOf(attempt, CONTACT_DELIVERY_CHANNEL.Email, `${admin?.name ?? "?"} (SystemAdmin)`, null),
    );
  }
  return rows;
}

export function createRequestDeliveryQuery(opts: ContactOptions) {
  return defineQueryHandler({
    name: "request-delivery",
    schema: ContactIdSchema,
    access: adminAccess,
    description:
      "Returns where one contact request went and how: the admin mails, the Telegram message and each answer as mail and in-app note, each with channel, recipient, time and delivery status (an in-app note shows as read with the time it was opened), as flat rows for a related list.",
    handler: async (event, ctx) => {
      const db = contactDb(ctx);
      const { id } = event.payload;
      const request = await requestExecutor.detail({ id }, platformActor(), db);
      if (!request) throw new NotFoundError(CONTACT_REQUEST_ENTITY, id);
      const replies = await listRepliesOf(db, id);
      const replyInAppKeys = replies.map((reply) => contactIdempotencyKeys.replyInApp(reply.id));
      const attempts = await loadAttemptsByKey(ctx, event.user, [
        contactIdempotencyKeys.admins(id),
        contactIdempotencyKeys.telegram(id),
        ...replies.map((reply) => contactIdempotencyKeys.reply(reply.id)),
        ...replyInAppKeys,
      ]);
      const reporterTenantId = parseTenantId(request.reporterTenantId);
      const readAtByKey =
        reporterTenantId === null
          ? new Map<string, Temporal.Instant | null>()
          : await loadReadAtByKey(ctx, reporterTenantId, replyInAppKeys);

      const rows: DeliveryRow[] = [...(await adminRows(db, attempts, id))];
      if (opts.telegram) {
        const chat = await ctx.config?.(ContactConfigKeys.telegramChat);
        for (const attempt of attemptsOf(attempts, contactIdempotencyKeys.telegram(id))) {
          rows.push(
            rowOf(
              attempt,
              CONTACT_DELIVERY_CHANNEL.Telegram,
              typeof chat === "string" ? chat : "",
              null,
            ),
          );
        }
      }
      for (const reply of replies) {
        const mailKey = contactIdempotencyKeys.reply(reply.id);
        for (const attempt of attemptsOf(attempts, mailKey)) {
          rows.push(rowOf(attempt, CONTACT_DELIVERY_CHANNEL.ReplyEmail, request.name, null));
        }
        const inAppKey = contactIdempotencyKeys.replyInApp(reply.id);
        for (const attempt of attemptsOf(attempts, inAppKey)) {
          rows.push(
            rowOf(
              attempt,
              CONTACT_DELIVERY_CHANNEL.ReplyInApp,
              request.name,
              readAtByKey.get(inAppKey),
            ),
          );
        }
      }
      return { rows, nextCursor: null };
    },
  });
}
