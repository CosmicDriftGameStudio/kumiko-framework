// delivery.send job handler. Async (queued-mode) channels are delivered here instead of inline in
// notify(): the job renders (if the channel has a render step) and sends in one step. Neither
// rendered HTML nor plaintext content sits in Redis or the job-run table; a retry renders again.
// The `queued` attempt event is written by the delivery-service at dispatch time; this handler
// appends the terminal sent/failed event on the same stream.
//
// Compatibility: jobs queued by earlier versions (delivery.render, and delivery.send carrying
// `address`/`sealedAddress`, `message` and `rendered`) are still in Redis at deploy time and must
// not fail. deliveryRenderJob and the legacy send payload shape drain them; new jobs never use them.

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
import { fileContextForTenant } from "../file-foundation/index.ts";
import { errorKindOf } from "../shared/index.ts";
import {
  emailAttachmentRefSchema,
  MAX_EMAIL_ATTACHMENTS,
  toAttachmentRef,
} from "./attachment-ref.ts";
import { appendAttemptEvent } from "./attempt-log.ts";
import { buildChannelContext } from "./channel-context.ts";
import { DeliveryJobs, deliveryIdempotencyRedisKey, deliveryPriorityRank } from "./constants.ts";
import { collectChannels } from "./delivery-service.ts";
import {
  channelMessageSchema,
  type DeliveryJobContent,
  jobContentFieldSchema,
  openJobContent,
} from "./job-content-seal.ts";
import {
  openRecipientAddress,
  type RecipientAddressField,
  recipientAddressFieldSchema,
} from "./recipient-address-seal.ts";
import type {
  ChannelMessage,
  DeliveryChannel,
  DeliveryLogEntry,
  RenderedMessage,
} from "./types.ts";

const jobBaseSchema = z.object({
  channelName: z.string(),
  tenantId: z.string(),
  recipientId: z.string().nullable(),
  notificationType: z.string(),
  deliveryAttemptId: z.string(),
  priority: z.enum(["critical", "normal", "low"]),
  idempotencyKey: z.string().optional(),
  // The notify() key as given, for the channel context; idempotencyKey above is only the release key.
  notifyIdempotencyKey: z.string().optional(),
});

type JobBase = z.infer<typeof jobBaseSchema>;

const currentSendJobPayloadSchema = jobBaseSchema.and(jobContentFieldSchema);

// Payloads queued before the single send job: message and address travel as separate fields.
const legacyRenderJobPayloadSchema = jobBaseSchema
  .extend({ message: channelMessageSchema })
  .and(recipientAddressFieldSchema);

const legacySendJobPayloadSchema = jobBaseSchema
  .extend({
    message: channelMessageSchema,
    rendered: z
      .object({
        html: z.string(),
        subject: z.string(),
        text: z.string().optional(),
        fromName: z.string().optional(),
        replyTo: z.string().optional(),
        attachments: z.array(emailAttachmentRefSchema).max(MAX_EMAIL_ATTACHMENTS).optional(),
      })
      .optional(),
  })
  .and(recipientAddressFieldSchema);

const sendJobPayloadSchema = z.union([currentSendJobPayloadSchema, legacySendJobPayloadSchema]);

type LegacyRenderJobPayload = z.infer<typeof legacyRenderJobPayloadSchema>;
type LegacySendJobPayload = z.infer<typeof legacySendJobPayloadSchema>;
type LegacyRendered = LegacySendJobPayload["rendered"];

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

function resolveChannel(registry: Registry, name: string): DeliveryChannel {
  const channel = collectChannels(registry).find((c) => c.name === name);
  if (!channel) throw new Error(`delivery job: unknown channel "${name}"`);
  return channel;
}

function toMessage(message: DeliveryJobContent["message"]): ChannelMessage {
  return {
    notificationType: message.notificationType,
    title: message.title,
    body: message.body,
    data: message.data,
    locale: message.locale,
  };
}

function entryFor(
  p: JobBase,
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

// Assumes ctx.services.redis is the handle the service claimed on; runProdApp wires the same
// instance into both.
async function releaseIdempotencyKey(ctx: JobContext, p: JobBase): Promise<void> {
  // skip: no idempotency key was claimed for this notification
  if (!p.idempotencyKey) return;
  if (!ctx.services.redis) {
    ctx.obs.log.warn("delivery: idempotency key not released, job context has no redis", {
      notificationType: p.notificationType,
    });
    return;
  }
  try {
    await ctx.services.redis.del(deliveryIdempotencyRedisKey(p.tenantId, p.idempotencyKey));
  } catch (err) {
    ctx.obs.log.warn(`delivery: idempotency key release failed: ${errorKindOf(err)}`, {
      notificationType: p.notificationType,
    });
  }
}

// Only the final retry frees the key: earlier failures are retried by the runner and
// must still dedup.
async function releaseIdempotencyOnTerminalFailure(ctx: JobContext, p: JobBase): Promise<void> {
  // skip: not the last attempt, the runner retries and the key must keep deduplicating
  if (!ctx.finalAttempt) return;
  await releaseIdempotencyKey(ctx, p);
}

// Covers every throw after the payload parsed, not just the attempt-logged ones: a
// missing registry or unknown channel on the last attempt would otherwise hold the key
// until its TTL.
async function releasingKeyOnTerminalFailure<T>(
  ctx: JobContext,
  p: JobBase,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    await releaseIdempotencyOnTerminalFailure(ctx, p);
    throw err;
  }
}

// The job runner stores err.message in the run row, and BullMQ keeps failedReason and
// the stack trace in Redis in plain text, so the rethrown error carries only the code.
// The log gets the error class only: adapter texts can carry names or phone numbers.
async function failAttempt(
  ctx: JobContext,
  db: DbConnection,
  registry: Registry,
  p: JobBase,
  address: string | null,
  code: DeliveryErrorCode,
  err: unknown,
): Promise<never> {
  ctx.obs.log.error(`delivery.${p.channelName} ${code}: ${errorKindOf(err)}`, {
    notificationType: p.notificationType,
    channel: p.channelName,
  });
  await appendAttemptEvent(db, registry, p.deliveryAttemptId, entryFor(p, "failed", code, address));
  throw new Error(code);
}

// Render (if the channel has a render step) and deliver. On failure: record the terminal
// failed event and rethrow so BullMQ retries the whole job, which renders again.
export const deliverySendJob: JobHandlerFn = async (payload, ctx) => {
  const p = sendJobPayloadSchema.parse(payload);
  return releasingKeyOnTerminalFailure(ctx, p, () => sendStep(p, ctx));
};

// Legacy payloads carry address and message as separate fields, and a send step may already hold
// the rendered message; current payloads carry one content field.
async function openSendContent(
  p: z.infer<typeof sendJobPayloadSchema>,
  tenantId: TenantId,
  ctx: JobContext,
): Promise<{ content: DeliveryJobContent; rendered: LegacyRendered }> {
  if ("message" in p) {
    const address = await openRecipientAddress(p, tenantId, ctx.services.configEncryption);
    return { content: { address, message: p.message }, rendered: p.rendered };
  }
  return {
    content: await openJobContent(p, tenantId, ctx.services.configEncryption),
    rendered: undefined,
  };
}

async function sendStep(p: z.infer<typeof sendJobPayloadSchema>, ctx: JobContext): Promise<void> {
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const { db, registry } = requireTenantScopedDeps(ctx, tenantId);
  const channel = resolveChannel(registry, p.channelName);
  const channelCtx = buildChannelContext(
    db,
    registry,
    undefined,
    tenantId,
    ctx.services.secrets,
    ctx.config,
    (fileTenantId) => fileContextForTenant(ctx, ctx.systemUser.tenantId, fileTenantId),
    p.notifyIdempotencyKey,
  );

  // A missing or rotated key must not hide the original failure, so the log row just omits the address.
  let opened: Awaited<ReturnType<typeof openSendContent>>;
  try {
    opened = await openSendContent(p, tenantId, ctx);
  } catch (err) {
    return failAttempt(ctx, db, registry, p, null, "send_failed", err);
  }
  const { content } = opened;
  const message = toMessage(content.message);

  let rendered: RenderedMessage | undefined = opened.rendered;
  if (rendered === undefined && channel.render) {
    try {
      rendered = await channel.render(message, channelCtx);
    } catch (err) {
      return failAttempt(ctx, db, registry, p, content.address, "render_failed", err);
    }
  }

  let result: Awaited<ReturnType<typeof channel.send>>;
  try {
    result = await channel.send(content.address, message, channelCtx, rendered);
  } catch (err) {
    return failAttempt(ctx, db, registry, p, content.address, "send_failed", err);
  }

  // The message is out: rethrowing here would make BullMQ retry and send it again.
  try {
    await appendAttemptEvent(
      db,
      registry,
      p.deliveryAttemptId,
      entryFor(
        p,
        result.status,
        result.error ?? null,
        result.address ?? content.address,
        result.confirmed,
      ),
    );
  } catch (err) {
    ctx.obs.log.error(
      `delivery.${p.channelName} sent but attempt log failed: ${errorKindOf(err)}`,
      { notificationType: p.notificationType, channel: p.channelName },
    );
  }
  // A soft failure ends the job successfully, so no retry follows and the caller's
  // retry must not be skipped as a duplicate.
  if (result.status === "failed") await releaseIdempotencyKey(ctx, p);
}

function toSendRendered(rendered: RenderedMessage): LegacyRendered {
  return {
    html: rendered.html,
    subject: rendered.subject,
    ...(rendered.text !== undefined && { text: rendered.text }),
    ...(rendered.fromName !== undefined && { fromName: rendered.fromName }),
    ...(rendered.replyTo !== undefined && { replyTo: rendered.replyTo }),
    ...(rendered.attachments !== undefined && {
      attachments: rendered.attachments.map(toAttachmentRef),
    }),
  };
}

// A missing or rotated key must not hide the original failure, so the log row just omits the address.
async function addressForAttemptLog(
  p: RecipientAddressField & { readonly tenantId: string },
  ctx: JobContext,
): Promise<string | null> {
  try {
    return await openRecipientAddress(
      p,
      p.tenantId as TenantId, // @cast-boundary engine-payload — job payload string is the stream tenant
      ctx.services.configEncryption,
    );
  } catch {
    return null;
  }
}

// Drains render jobs queued before the single send job: renders, then dispatches a legacy-shaped
// send job carrying the rendered message. On failure: record the terminal failed event and
// rethrow so BullMQ retries this step.
export const deliveryRenderJob: JobHandlerFn = async (payload, ctx) => {
  const p = legacyRenderJobPayloadSchema.parse(payload);
  return releasingKeyOnTerminalFailure(ctx, p, () => legacyRenderStep(p, ctx));
};

async function legacyRenderStep(p: LegacyRenderJobPayload, ctx: JobContext): Promise<void> {
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const { db, registry } = requireTenantScopedDeps(ctx, tenantId);
  const channel = resolveChannel(registry, p.channelName);
  const channelCtx = buildChannelContext(
    db,
    registry,
    undefined,
    tenantId,
    ctx.services.secrets,
    ctx.config,
    (fileTenantId) => fileContextForTenant(ctx, ctx.systemUser.tenantId, fileTenantId),
    p.notifyIdempotencyKey,
  );

  let rendered: RenderedMessage;
  try {
    if (!channel.render) {
      throw new Error(`delivery.render: channel "${p.channelName}" has no render step`);
    }
    rendered = await channel.render(toMessage(p.message), channelCtx);
  } catch (err) {
    return failAttempt(
      ctx,
      db,
      registry,
      p,
      await addressForAttemptLog(p, ctx),
      "render_failed",
      err,
    );
  }
  try {
    const jobRunner = ctx.services.jobRunner as JobRunner; // @cast-boundary engine-bridge — dispatch lives on the concrete runner
    await jobRunner.dispatch(
      DeliveryJobs.send,
      { ...p, rendered: toSendRendered(rendered) },
      { priority: deliveryPriorityRank[p.priority] },
    );
  } catch (err) {
    return failAttempt(
      ctx,
      db,
      registry,
      p,
      await addressForAttemptLog(p, ctx),
      "channel_error",
      err,
    );
  }
}
