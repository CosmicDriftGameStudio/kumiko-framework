import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type {
  ConfigAccessor,
  DeliveryErrorCode,
  NotifyDeliveryStatus,
  NotifyDispatched,
  NotifyJobDispatcher,
  NotifyOptions,
  NotifyPriority,
  Registry,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { FileProviderResolver } from "@cosmicdrift/kumiko-framework/files";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { MailPayload, RenderedTemplateRef } from "../renderer-foundation/index.ts";
import type { EmailAttachmentRef } from "./attachment-ref.ts";
import { DELIVERY_CHANNEL_EXTENSION } from "./constants.ts";

// --- Channel Interface ---

export type RenderedMail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly previewText?: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly attachments?: readonly EmailAttachmentRef[];
  /** The layout version the html was rendered through; the editor preview names it. */
  readonly layout?: RenderedTemplateRef;
};

export type ChannelContext = {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly sseBroker: SseBroker | undefined;
  readonly tenantId: TenantId;
  // Chat channels read their per-tenant webhook URL / bot token from it.
  // Absent when no secrets feature/KEK is wired.
  readonly secrets?: SecretsContext | undefined;
  // The tenant's own config accessor, built server-side for this tenantId. Absent when the
  // delivery service has no tenantConfigFor and the job context carries no config.
  readonly config?: ConfigAccessor | undefined;
  // The notify() idempotencyKey of the call, so a channel can store it next to what it sends.
  readonly idempotencyKey?: string | undefined;
  // Renders a stored mail template, the tenant's own or the system fallback.
  readonly renderMail?: (payload: MailPayload) => Promise<RenderedMail>;
  // Reads the bytes behind an attachment ref at send time. Absent when no file storage is wired.
  readonly readAttachment?: (
    ref: EmailAttachmentRef,
    origin?: AttachmentOrigin,
  ) => Promise<{ readonly content: Uint8Array; readonly contentType: string } | null>;
};

// "template": the renderer returned the ref from the stored template (own or system). "message":
// the ref came from notify data, so a caller chose it. Unset means "message".
export type AttachmentOrigin = "template" | "message";

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
  readonly text?: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly attachments?: readonly EmailAttachmentRef[];
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
  // "connection-name": the address is a tenant-chosen connection name (chat webhooks), not
  // personal data, so the attempt log keeps it unmasked. Absent = personal, masked.
  readonly addressKind?: "connection-name";
  render?(message: ChannelMessage, ctx: ChannelContext): Promise<RenderedMessage>;
  send(
    address: string,
    message: ChannelMessage,
    ctx: ChannelContext,
    rendered?: RenderedMessage,
  ): Promise<ChannelResult>;
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
  readonly idempotencyKey?: string;
};

// --- Delivery Service ---

export type DeliveryService = {
  notify(
    notificationType: string,
    options: NotifyOptions,
    user: SessionUser,
    tenantId: TenantId,
    jobDispatcher?: NotifyJobDispatcher,
    deliveryDb?: DbConnection,
    fileProviderResolver?: FileProviderResolver,
  ): Promise<NotifyDispatched>;
};

// r.useExtension options-shape: `name` is NOT part of the registration
// payload — collectChannels derives it from the usage's entityName instead.
export type DeliveryChannelPlugin = Omit<DeliveryChannel, "name">;

function hasOptionalHooks(o: object): boolean {
  return (
    (!("render" in o) || o.render === undefined || typeof o.render === "function") &&
    (!("resolve" in o) || o.resolve === undefined || typeof o.resolve === "function") &&
    (!("addressKind" in o) || o.addressKind === undefined || o.addressKind === "connection-name")
  );
}

export function isDeliveryChannelPlugin(o: unknown): o is DeliveryChannelPlugin {
  return (
    typeof o === "object" &&
    o !== null &&
    "mode" in o &&
    DELIVERY_CHANNEL_MODES.some((mode) => mode === o.mode) &&
    hasOptionalHooks(o) &&
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
