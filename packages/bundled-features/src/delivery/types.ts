import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  NotifyOptions,
  NotifyPriority,
  Registry,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";

// --- Channel Interface ---

export type ChannelContext = {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly sseBroker: SseBroker | undefined;
  readonly tenantId: TenantId;
};

export type ChannelMessage = {
  readonly notificationType: string;
  readonly title: string;
  readonly body: string | undefined;
  readonly data: Readonly<Record<string, unknown>> | undefined;
};

export type ChannelResult = {
  readonly status: "sent" | "failed" | "skipped";
  readonly error?: string;
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
export type DeliveryChannelMode = "inline" | "queued";

export type DeliveryChannel = {
  readonly name: string;
  readonly mode: DeliveryChannelMode;
  resolve(userId: string, ctx: ChannelContext): Promise<string | null>;
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
  readonly status: "queued" | "sent" | "failed" | "skipped";
  readonly error: string | null;
  readonly priority: NotifyPriority;
};

// --- Delivery Service ---

export type DeliveryService = {
  notify(
    notificationType: string,
    options: NotifyOptions,
    user: SessionUser,
    tenantId: TenantId,
  ): Promise<void>;
};
