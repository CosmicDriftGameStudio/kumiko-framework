import type { DbRow } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  type ChannelMessage,
  DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  DELIVERY_UNSUBSCRIBE_PATH,
  type DeliveryChannel,
  type NotificationRenderer,
  type RenderedMessage,
} from "../delivery";
import { guardEmailMessage } from "./pii-guard";
import type { EmailTransport } from "./types";

// Envelope (From / Reply-To / threading headers) rides on the channel data —
// the notification's email template echoes it out of the notify() call, since
// buildMessage collapses the raw data to the template's result. Content
// (subject, html) is rendered; these three are copied straight to the message.
function stringHeaders(raw: unknown): Readonly<Record<string, string>> | undefined {
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Only the framework's own unsubscribe route can honor a one-click POST.
function listUnsubscribeHeaders(
  data: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string>> | undefined {
  const rawUrl = data?.["unsubscribeUrl"];
  if (typeof rawUrl !== "string") return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (url.pathname !== DELIVERY_UNSUBSCRIBE_PATH) return undefined;
  return {
    "List-Unsubscribe": `<${url.toString()}>`,
    "List-Unsubscribe-Post": DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  };
}

function emailEnvelopeFrom(data: Readonly<Record<string, unknown>> | undefined): {
  from?: string;
  replyTo?: string;
  headers?: Readonly<Record<string, string>>;
} {
  if (!data) return {};
  const from = typeof data["from"] === "string" ? data["from"] : undefined;
  const replyTo = typeof data["replyTo"] === "string" ? data["replyTo"] : undefined;
  const autoHeaders = listUnsubscribeHeaders(data);
  const explicitHeaders = stringHeaders(data["headers"]);
  const headers =
    autoHeaders || explicitHeaders ? { ...autoHeaders, ...explicitHeaders } : undefined;
  return { ...(from && { from }), ...(replyTo && { replyTo }), ...(headers && { headers }) };
}

export type EmailChannelOptions = {
  readonly transport: EmailTransport;
  readonly renderer: NotificationRenderer;
  readonly resolveEmail: (
    userId: string,
    ctx: { db: unknown; tenantId: TenantId },
  ) => Promise<string | null>;
};

export function createEmailChannel(options: EmailChannelOptions): DeliveryChannel {
  const { transport, renderer, resolveEmail } = options;

  // Render is the expensive step (template engine, possibly a remote service)
  // and runs in the delivery.render job, decoupled from the SMTP send so each
  // can retry independently. Extracted so the inline fallback (no job runner)
  // can reuse it without going through the channel's own render() indirection.
  async function renderMessage(message: ChannelMessage): Promise<RenderedMessage> {
    // Build renderer input: per-channel template data (if any) or fall back
    // to title/body from the message. Renderer handles both cases.
    const variables = (message.data as DbRow) ?? {
      title: message.title,
      body: message.body,
    };
    const html = await renderer.render({
      template: message.notificationType,
      variables,
    });
    const subject = (variables["subject"] as string) ?? message.title; // @cast-boundary dynamic-key
    return { html, subject };
  }

  return {
    name: "email",
    mode: "queued",

    async resolve(userId, ctx) {
      return resolveEmail(userId, ctx);
    },

    render(message, _ctx) {
      return renderMessage(message);
    },

    async send(address, message, _ctx, rendered) {
      const { html, subject } = rendered ?? (await renderMessage(message));
      const envelope = emailEnvelopeFrom(message.data);
      await transport.send(guardEmailMessage({ to: address, subject, html, ...envelope }));
      return { status: "sent", address };
    },
  };
}
