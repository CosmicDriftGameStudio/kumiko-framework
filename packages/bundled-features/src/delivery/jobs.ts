// delivery.render → delivery.send job handlers. Async (queued-mode) channels
// are delivered here instead of inline in notify(): render runs the expensive
// template step in its own worker and dispatches send on success, so a render
// crash never blocks the SMTP send and each step retries independently. The
// `queued` attempt event is written by the delivery-service at dispatch time;
// these handlers append the terminal sent/failed event on the same stream.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  DeliveryErrorCode,
  JobContext,
  JobHandlerFn,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import * as z from "zod";
import { fileContextForTenant } from "../file-foundation/index.js";
import {
  emailAttachmentRefSchema,
  MAX_EMAIL_ATTACHMENTS,
  toAttachmentRef,
} from "./attachment-ref.js";
import { appendAttemptEvent } from "./attempt-log.js";
import { buildChannelContext } from "./channel-context.js";
import { DeliveryJobs, deliveryIdempotencyRedisKey, deliveryPriorityRank } from "./constants.js";
import { collectChannels, redactedMessageOf } from "./delivery-service.js";
import type {
  ChannelMessage,
  DeliveryChannel,
  DeliveryLogEntry,
  RenderedMessage,
} from "./types.js";

const channelMessageSchema = z.object({
  notificationType: z.string(),
  title: z.string(),
  body: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  locale: z.string().optional(),
});

const renderJobPayloadSchema = z.object({
  channelName: z.string(),
  address: z.string(),
  tenantId: z.string(),
  recipientId: z.string().nullable(),
  notificationType: z.string(),
  deliveryAttemptId: z.string(),
  priority: z.enum(["critical", "normal", "low"]),
  message: channelMessageSchema,
  idempotencyKey: z.string().optional(),
});

const sendJobPayloadSchema = renderJobPayloadSchema.extend({
  rendered: z
    .object({
      html: z.string(),
      subject: z.string(),
      text: z.string().optional(),
      attachments: z.array(emailAttachmentRefSchema).max(MAX_EMAIL_ATTACHMENTS).optional(),
    })
    .optional(),
});

type RenderJobPayload = z.infer<typeof renderJobPayloadSchema>;

function requireTenantScopedDeps(
  ctx: JobContext,
  tenantId: TenantId,
): { db: DbConnection; registry: Registry } {
  const registry = ctx.registry;
  if (!registry) throw new Error("delivery job: missing registry in job context");
  // delivery is r.systemScope()'d, so JobContext.systemDb is guaranteed; unsafeRaw
  // hands the underlying DbConnection to both — safe since they filter by tenantId themselves.
  // Attachment lookups read only this tenant's FileRefs, plus the system tenant's for inline images.
  if (!ctx.systemDb) {
    throw new InternalError({
      message: "delivery job: ctx.systemDb missing on a system-scoped job",
    });
  }
  // Also makes ctx.config (built for the job's tenant) the accessor of the payload tenant;
  // job contexts carry no configFor.
  ctx.systemDb.assertTenantMatch(tenantId);
  const db = ctx.systemDb.unsafeRaw(
    "attempt append and channel context filter by this job's tenantId; attachment lookup reads only the job tenant's FileRefs plus, for inline images, the system tenant's",
  ) as DbConnection; // @cast-boundary db-operator — DbRunner narrows to DbConnection, jobs never run inside a DbTx
  return { db, registry };
}

function toSendRendered(
  rendered: RenderedMessage,
): z.infer<typeof sendJobPayloadSchema>["rendered"] {
  return {
    html: rendered.html,
    subject: rendered.subject,
    ...(rendered.text !== undefined && { text: rendered.text }),
    ...(rendered.attachments !== undefined && {
      attachments: rendered.attachments.map(toAttachmentRef),
    }),
  };
}

function resolveChannel(registry: Registry, name: string): DeliveryChannel {
  const channel = collectChannels(registry).find((c) => c.name === name);
  if (!channel) throw new Error(`delivery job: unknown channel "${name}"`);
  return channel;
}

function toMessage(p: RenderJobPayload): ChannelMessage {
  return {
    notificationType: p.message.notificationType,
    title: p.message.title,
    body: p.message.body,
    data: p.message.data,
    locale: p.message.locale,
  };
}

function entryFor(
  p: RenderJobPayload,
  status: DeliveryLogEntry["status"],
  error: DeliveryErrorCode | null,
  address: string | null,
  confirmed?: false,
): DeliveryLogEntry {
  return {
    tenantId: p.tenantId as TenantId, // @cast-boundary engine-payload — job payload string is the stream tenant
    notificationType: p.notificationType,
    channel: p.channelName,
    recipientId: p.recipientId,
    recipientAddress: address,
    status,
    error,
    priority: p.priority,
    ...(confirmed === false && { confirmed }),
  };
}

// Only the final retry frees the key: earlier failures are retried by the runner and
// must still dedup. Assumes ctx.redis is the handle the service claimed on; runProdApp
// wires the same instance into both.
async function releaseIdempotencyOnTerminalFailure(
  ctx: JobContext,
  p: RenderJobPayload,
): Promise<void> {
  // skip: nothing to release before the last attempt or without an idempotency key
  if (!ctx.finalAttempt || !p.idempotencyKey) return;
  if (!ctx.redis) {
    ctx.log.warn("delivery: idempotency key not released, job context has no redis", {
      notificationType: p.notificationType,
    });
    return;
  }
  try {
    await ctx.redis.del(deliveryIdempotencyRedisKey(p.tenantId, p.idempotencyKey));
  } catch (err) {
    ctx.log.warn(`delivery: idempotency key release failed: ${redactedMessageOf(err)}`, {
      notificationType: p.notificationType,
    });
  }
}

// The job runner stores err.message in the run row, and BullMQ keeps failedReason and
// the stack trace in Redis in plain text, so the rethrown error carries only the code.
// The redacted message goes to the log.
async function failAttempt(
  ctx: JobContext,
  db: DbConnection,
  registry: Registry,
  p: RenderJobPayload,
  code: DeliveryErrorCode,
  err: unknown,
): Promise<never> {
  const message = redactedMessageOf(err);
  ctx.log.error(`delivery.${p.channelName} ${code}: ${message}`, {
    notificationType: p.notificationType,
    channel: p.channelName,
  });
  await appendAttemptEvent(
    db,
    registry,
    p.deliveryAttemptId,
    entryFor(p, "failed", code, p.address),
  );
  await releaseIdempotencyOnTerminalFailure(ctx, p);
  throw new Error(code);
}

// Render the message and hand off to delivery.send. On failure: record the
// terminal failed event and rethrow so BullMQ retries this step (re-render);
// the send step is never reached, so a stuck render can't half-send.
export const deliveryRenderJob: JobHandlerFn = async (payload, ctx) => {
  const p = renderJobPayloadSchema.parse(payload);
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const { db, registry } = requireTenantScopedDeps(ctx, tenantId);
  const channel = resolveChannel(registry, p.channelName);
  const channelCtx = buildChannelContext(
    db,
    registry,
    undefined,
    tenantId,
    ctx.secrets,
    ctx.config,
    (fileTenantId) => fileContextForTenant(ctx, fileTenantId),
  );

  let rendered: RenderedMessage;
  try {
    if (!channel.render) {
      throw new Error(`delivery.render: channel "${p.channelName}" has no render step`);
    }
    rendered = await channel.render(toMessage(p), channelCtx);
  } catch (err) {
    return failAttempt(ctx, db, registry, p, "render_failed", err);
  }
  try {
    const jobRunner = ctx["jobRunner"] as JobRunner; // @cast-boundary dynamic-key — dispatch lives on the concrete runner
    await jobRunner.dispatch(
      DeliveryJobs.send,
      { ...p, rendered: toSendRendered(rendered) },
      { priority: deliveryPriorityRank[p.priority] },
    );
  } catch (err) {
    return failAttempt(ctx, db, registry, p, "channel_error", err);
  }
};

// Deliver via the channel using the rendered payload (if any). On failure:
// record the terminal failed event and rethrow so BullMQ retries the send with
// the same already-rendered HTML — no re-render needed.
export const deliverySendJob: JobHandlerFn = async (payload, ctx) => {
  const p = sendJobPayloadSchema.parse(payload);
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const { db, registry } = requireTenantScopedDeps(ctx, tenantId);
  const channel = resolveChannel(registry, p.channelName);
  const channelCtx = buildChannelContext(
    db,
    registry,
    undefined,
    tenantId,
    ctx.secrets,
    ctx.config,
    (fileTenantId) => fileContextForTenant(ctx, fileTenantId),
  );

  try {
    const result = await channel.send(p.address, toMessage(p), channelCtx, p.rendered);
    await appendAttemptEvent(
      db,
      registry,
      p.deliveryAttemptId,
      entryFor(
        p,
        result.status,
        result.error ?? null,
        result.address ?? p.address,
        result.confirmed,
      ),
    );
  } catch (err) {
    return failAttempt(ctx, db, registry, p, "send_failed", err);
  }
};
