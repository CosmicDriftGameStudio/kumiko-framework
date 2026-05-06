import type { SseBroker } from "@cosmicdrift/kumiko-framework/api";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type {
  NotifyOptions,
  Registry,
  SessionUser,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";

// --- Channel Interface ---

export type ChannelContext = {
  readonly db: DbConnection;
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

export type DeliveryChannel = {
  readonly name: string;
  resolve(userId: string, ctx: ChannelContext): Promise<string | null>;
  send(address: string, message: ChannelMessage, ctx: ChannelContext): Promise<ChannelResult>;
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
  readonly status: "sent" | "failed" | "skipped";
  readonly error: string | null;
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
