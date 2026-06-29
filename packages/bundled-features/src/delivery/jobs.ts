// delivery.render → delivery.send job handlers. Async (queued-mode) channels
// are delivered here instead of inline in notify(): render runs the expensive
// template step in its own worker and dispatches send on success, so a render
// crash never blocks the SMTP send and each step retries independently. The
// `queued` attempt event is written by the delivery-service at dispatch time;
// these handlers append the terminal sent/failed event on the same stream.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  AppContext,
  JobHandlerFn,
  Registry,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { JobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import { z } from "zod";
import { appendAttemptEvent } from "./attempt-log";
import { buildChannelContext } from "./channel-context";
import { DeliveryJobs, deliveryPriorityRank } from "./constants";
import { collectChannels } from "./delivery-service";
import type { ChannelMessage, DeliveryChannel, DeliveryLogEntry, RenderedMessage } from "./types";

const channelMessageSchema = z.object({
  notificationType: z.string(),
  title: z.string(),
  body: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
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
});

const sendJobPayloadSchema = renderJobPayloadSchema.extend({
  rendered: z.object({ html: z.string(), subject: z.string() }).optional(),
});

type RenderJobPayload = z.infer<typeof renderJobPayloadSchema>;

function requireDeps(ctx: AppContext): { db: DbConnection; registry: Registry } {
  const registry = ctx.registry;
  if (!registry) throw new Error("delivery job: missing registry in job context");
  // Job context provides the raw system connection (not tenant-scoped); the
  // append + projection layer scopes per event payload.
  const db = ctx.db as DbConnection; // @cast-boundary engine-bridge — job ctx db is the system connection
  if (!db) throw new Error("delivery job: missing db in job context");
  return { db, registry };
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
  };
}

function entryFor(
  p: RenderJobPayload,
  status: DeliveryLogEntry["status"],
  error: string | null,
  address: string | null,
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
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Render the message and hand off to delivery.send. On failure: record the
// terminal failed event and rethrow so BullMQ retries this step (re-render);
// the send step is never reached, so a stuck render can't half-send.
export const deliveryRenderJob: JobHandlerFn = async (payload, ctx) => {
  const p = renderJobPayloadSchema.parse(payload);
  const { db, registry } = requireDeps(ctx);
  const channel = resolveChannel(registry, p.channelName);
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const channelCtx = buildChannelContext(db, registry, undefined, tenantId);

  try {
    if (!channel.render) {
      throw new Error(`delivery.render: channel "${p.channelName}" has no render step`);
    }
    const rendered: RenderedMessage = await channel.render(toMessage(p), channelCtx);
    const jobRunner = ctx["jobRunner"] as JobRunner; // @cast-boundary dynamic-key — dispatch lives on the concrete runner
    await jobRunner.dispatch(
      DeliveryJobs.send,
      { ...p, rendered },
      { priority: deliveryPriorityRank[p.priority] },
    );
  } catch (err) {
    await appendAttemptEvent(
      db,
      registry,
      p.deliveryAttemptId,
      entryFor(p, "failed", `render: ${messageOf(err)}`, p.address),
    );
    throw err;
  }
};

// Deliver via the channel using the rendered payload (if any). On failure:
// record the terminal failed event and rethrow so BullMQ retries the send with
// the same already-rendered HTML — no re-render needed.
export const deliverySendJob: JobHandlerFn = async (payload, ctx) => {
  const p = sendJobPayloadSchema.parse(payload);
  const { db, registry } = requireDeps(ctx);
  const channel = resolveChannel(registry, p.channelName);
  const tenantId = p.tenantId as TenantId; // @cast-boundary engine-payload — stream tenant
  const channelCtx = buildChannelContext(db, registry, undefined, tenantId);

  try {
    const result = await channel.send(p.address, toMessage(p), channelCtx, p.rendered);
    await appendAttemptEvent(
      db,
      registry,
      p.deliveryAttemptId,
      entryFor(p, result.status, result.error ?? null, result.address ?? p.address),
    );
  } catch (err) {
    await appendAttemptEvent(
      db,
      registry,
      p.deliveryAttemptId,
      entryFor(p, "failed", `send: ${messageOf(err)}`, p.address),
    );
    throw err;
  }
};
