import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  DeliveryErrorCode,
  NotifyDeliveryStatus,
  NotifyJobDispatcher,
  NotifyOptions,
  NotifyPriority,
  NotifyResult,
  Registry,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { DELIVERY_CHANNEL_EXTENSION } from "./constants.js";

// --- Channel Interface ---

export type ChannelContext = {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly sseBroker: SseBroker | undefined;
  readonly tenantId: TenantId;
  // Chat channels read their per-tenant webhook URL / bot token from it.
  // Absent when no secrets feature/KEK is wired.
  readonly secrets?: SecretsContext | undefined;
};

export type ChannelMessage = {
  readonly notificationType: string;
  readonly title: string;
  readonly body: string | undefined;
  readonly data: Readonly<Record<string, unknown>> | undefined;
  readonly locale?: string | undefined;
};

export type ChannelResult = {
  readonly status: "sent" | "failed" | "skipped";
  readonly error?: DeliveryErrorCode;
  // Only ever set to false: the provider accepted the message but did not confirm delivery.
  readonly confirmed?: false;
  readonly address?: string;
};

// Output of a channel's render step, passed into send(). Only channels that
// declare render() (email) produce one; inline channels (inApp) and channels
// without an expensive render step (push) receive `undefined`.
export type RenderedMessage = {
  readonly html: string;
  readonly subject: string;
};

// `mode` decides how the delivery-service dispatches a channel:
//   inline — sent synchronously inside notify() (inApp: DB insert + SSE).
//   queued — sent asynchronously via the delivery.send job; channels with a
//            render() additionally run through delivery.render first.
export const DELIVERY_CHANNEL_MODES = ["inline", "queued"] as const;
export type DeliveryChannelMode = (typeof DELIVERY_CHANNEL_MODES)[number];

export type DeliveryChannel = {
  readonly name: string;
  readonly mode: DeliveryChannelMode;
  // Absent for channels addressed only through `route` (tenant-owned chat
  // targets): deliverToUser skips them without writing a no_address row.
  resolve?(userId: string, ctx: ChannelContext): Promise<string | null>;
  render?(message: ChannelMessage, ctx: ChannelContext): Promise<RenderedMessage>;
  send(
    address: string,
    message: ChannelMessage,
    ctx: ChannelContext,
    rendered?: RenderedMessage,
  ): Promise<ChannelResult>;
};

// --- Notification Renderer ---

export type RendererInput = {
  readonly template: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly locale?: string | undefined;
};

export type NotificationRenderer = {
  readonly name: string;
  render(input: RendererInput): Promise<string>;
};

// --- Delivery Log Entry ---

export type DeliveryLogEntry = {
  readonly tenantId: TenantId;
  readonly notificationType: string;
  readonly channel: string;
  readonly recipientId: string | null;
  readonly recipientAddress: string | null;
  readonly status: NotifyDeliveryStatus;
  readonly error: DeliveryErrorCode | null;
  readonly priority: NotifyPriority;
  readonly confirmed?: false;
};

// --- Delivery Service ---

export type DeliveryService = {
  notify(
    notificationType: string,
    options: NotifyOptions,
    user: SessionUser,
    tenantId: TenantId,
    jobDispatcher?: NotifyJobDispatcher,
  ): Promise<NotifyResult>;
};

// r.useExtension options-shape: `name` is NOT part of the registration
// payload — collectChannels derives it from the usage's entityName instead.
export type DeliveryChannelPlugin = Omit<DeliveryChannel, "name">;

export function isDeliveryChannelPlugin(o: unknown): o is DeliveryChannelPlugin {
  return (
    typeof o === "object" &&
    o !== null &&
    "mode" in o &&
    DELIVERY_CHANNEL_MODES.some((mode) => mode === o.mode) &&
    (!("render" in o) || o.render === undefined || typeof o.render === "function") &&
    (!("resolve" in o) || o.resolve === undefined || typeof o.resolve === "function") &&
    "send" in o &&
    typeof o.send === "function"
  );
}

// r.useExtension options-shape, co-located since the framework never imports upward.
declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoExtensionOptionsMap {
    [DELIVERY_CHANNEL_EXTENSION]: DeliveryChannelPlugin;
  }
}
