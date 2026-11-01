import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { parseTenantId } from "@cosmicdrift/kumiko-types/identifiers";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  adminAccess,
  helpdeskDb,
  listRepliesOf,
  loadUserLabel,
  platformActor,
  requestExecutor,
} from "../lib.ts";
import type { HelpdeskOptions } from "../options.ts";
import { HelpdeskIdSchema } from "../payloads.ts";
import {
  HELPDESK_DELIVERY_CHANNEL,
  HELPDESK_DELIVERY_STATUS,
  HELPDESK_REQUEST_ENTITY,
  HelpdeskConfigKeys,
  type HelpdeskDeliveryChannel,
  type HelpdeskDeliveryStatus,
  helpdeskIdempotencyKeys,
} from "../web/constants.ts";
import { type HelpdeskAttempt, loadAttemptsByKey, loadReadAtByKey } from "./attempts.ts";

type DeliveryRow = {
  readonly id: string;
  readonly channel: HelpdeskDeliveryChannel;
  readonly recipient: string;
  readonly at: string;
  readonly status: HelpdeskDeliveryStatus;
};

function displayStatus(attemptStatus: string): HelpdeskDeliveryStatus {
  switch (attemptStatus) {
    case "sent":
      return HELPDESK_DELIVERY_STATUS.Delivered;
    case "failed":
      return HELPDESK_DELIVERY_STATUS.Failed;
    case "skipped":
      return HELPDESK_DELIVERY_STATUS.Skipped;
    default:
      return HELPDESK_DELIVERY_STATUS.Pending;
  }
}

function attemptsOf(attempts: readonly HelpdeskAttempt[], key: string): readonly HelpdeskAttempt[] {
  return attempts.filter((attempt) => attempt.key === key);
}

function rowOf(
  attempt: HelpdeskAttempt,
  channel: HelpdeskDeliveryChannel,
  recipient: string,
  readAt: Temporal.Instant | null | undefined,
): DeliveryRow {
  const read = readAt !== undefined && readAt !== null;
  return {
    id: `${attempt.key}:${attempt.channel}:${attempt.recipientId ?? ""}`,
    channel,
    recipient,
    at: (read ? readAt : attempt.createdAt).toString(),
    status: read ? HELPDESK_DELIVERY_STATUS.Read : displayStatus(attempt.status),
  };
}

async function adminRows(
  db: TenantDb,
  attempts: readonly HelpdeskAttempt[],
  requestId: string,
): Promise<readonly DeliveryRow[]> {
  const rows: DeliveryRow[] = [];
  for (const attempt of attemptsOf(attempts, helpdeskIdempotencyKeys.admins(requestId))) {
    const admin = attempt.recipientId ? await loadUserLabel(db, attempt.recipientId) : null;
    rows.push(
      rowOf(attempt, HELPDESK_DELIVERY_CHANNEL.Email, `${admin?.name ?? "?"} (SystemAdmin)`, null),
    );
  }
  return rows;
}

export function createRequestDeliveryQuery(opts: HelpdeskOptions) {
  return defineQueryHandler({
    name: "request-delivery",
    schema: HelpdeskIdSchema,
    access: adminAccess,
    description:
      "Returns where one contact request went and how: the admin mails, the Telegram message and each answer as mail and in-app note, each with channel, recipient, time and delivery status (an in-app note shows as read with the time it was opened), as flat rows for a related list.",
    handler: async (event, ctx) => {
      const db = helpdeskDb(ctx);
      const { id } = event.payload;
      const request = await requestExecutor.detail({ id }, platformActor(), db);
      if (!request) throw new NotFoundError(HELPDESK_REQUEST_ENTITY, id);
      const replies = await listRepliesOf(db, id);
      const replyInAppKeys = replies.map((reply) => helpdeskIdempotencyKeys.replyInApp(reply.id));
      const attempts = await loadAttemptsByKey(ctx, event.user, [
        helpdeskIdempotencyKeys.admins(id),
        helpdeskIdempotencyKeys.telegram(id),
        ...replies.map((reply) => helpdeskIdempotencyKeys.reply(reply.id)),
        ...replyInAppKeys,
      ]);
      const reporterTenantId = parseTenantId(request.reporterTenantId);
      const readAtByKey =
        reporterTenantId === null
          ? new Map<string, Temporal.Instant | null>()
          : await loadReadAtByKey(ctx, reporterTenantId, replyInAppKeys);

      const rows: DeliveryRow[] = [...(await adminRows(db, attempts, id))];
      if (opts.telegram) {
        const chat = await ctx.config?.(HelpdeskConfigKeys.telegramChat);
        for (const attempt of attemptsOf(attempts, helpdeskIdempotencyKeys.telegram(id))) {
          rows.push(
            rowOf(
              attempt,
              HELPDESK_DELIVERY_CHANNEL.Telegram,
              typeof chat === "string" ? chat : "",
              null,
            ),
          );
        }
      }
      for (const reply of replies) {
        const mailKey = helpdeskIdempotencyKeys.reply(reply.id);
        for (const attempt of attemptsOf(attempts, mailKey)) {
          rows.push(rowOf(attempt, HELPDESK_DELIVERY_CHANNEL.ReplyEmail, request.name, null));
        }
        const inAppKey = helpdeskIdempotencyKeys.replyInApp(reply.id);
        for (const attempt of attemptsOf(attempts, inAppKey)) {
          rows.push(
            rowOf(
              attempt,
              HELPDESK_DELIVERY_CHANNEL.ReplyInApp,
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
