import { PII_ERASED_SENTINEL } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  type AttachmentOrigin,
  type ChannelContext,
  type ChannelMessage,
  DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  DELIVERY_UNSUBSCRIBE_PATH,
  type DeliveryChannel,
  EMAIL_CHANNEL_NAME,
  type EmailAttachmentRef,
  fileAttachmentRefSchema,
  MAX_EMAIL_ATTACHMENTS,
  type RenderedMessage,
  renderedPdfAttachmentRefSchema,
} from "../delivery/index.js";
import { decryptStoredPii, extensionForResourceContentType } from "../shared/index.js";
import { guardEmailMessage } from "./pii-guard.js";
import type { EmailAttachment, EmailTransport } from "./types.js";

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

const UNSUBSCRIBE_HEADER_NAMES: ReadonlySet<string> = new Set([
  "list-unsubscribe",
  "list-unsubscribe-post",
]);

// Only the framework's own unsubscribe route can honor a one-click POST; an app's
// own unsubscribe page still gets the plain List-Unsubscribe link (RFC 2369).
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
  if (url.pathname !== DELIVERY_UNSUBSCRIBE_PATH) {
    return { "List-Unsubscribe": `<${url.toString()}>` };
  }
  return {
    "List-Unsubscribe": `<${url.toString()}>`,
    "List-Unsubscribe-Post": DELIVERY_UNSUBSCRIBE_ONE_CLICK_HEADER_VALUE,
  };
}

function emailEnvelopeFrom(data: Readonly<Record<string, unknown>> | undefined): {
  from?: string;
  fromName?: string;
  replyTo?: string;
  headers?: Readonly<Record<string, string>>;
} {
  if (!data) return {};
  const from = typeof data["from"] === "string" ? data["from"] : undefined;
  const fromName = typeof data["fromName"] === "string" ? data["fromName"] : undefined;
  const replyTo = typeof data["replyTo"] === "string" ? data["replyTo"] : undefined;
  const autoHeaders = listUnsubscribeHeaders(data);
  const explicitHeaders = stringHeaders(data["headers"]);
  // Header names are case-insensitive, and the auto pair only works together:
  // an explicit override of either half must drop both, or a mail client would
  // one-click POST to a URL that cannot handle it.
  const overridesUnsubscribe =
    explicitHeaders !== undefined &&
    Object.keys(explicitHeaders).some((name) => UNSUBSCRIBE_HEADER_NAMES.has(name.toLowerCase()));
  const headers =
    (!overridesUnsubscribe && autoHeaders) || explicitHeaders
      ? { ...(overridesUnsubscribe ? undefined : autoHeaders), ...explicitHeaders }
      : undefined;
  return {
    ...(from && { from }),
    ...(fromName && { fromName }),
    ...(replyTo && { replyTo }),
    ...(headers && { headers }),
  };
}

const fileAttachmentsSchema = z
  .array(z.discriminatedUnion("kind", [fileAttachmentRefSchema, renderedPdfAttachmentRefSchema]))
  .max(MAX_EMAIL_ATTACHMENTS);

// Only kinds "file" and "rendered-pdf" may come from notify data; inline images are created by the renderer alone.
// Invalid input throws instead of dropping the attachment silently.
export function fileAttachmentsFrom(
  data: Readonly<Record<string, unknown>> | undefined,
  messageLocale?: string,
): readonly EmailAttachmentRef[] {
  const raw = data?.["attachments"];
  if (raw === undefined) return [];
  return fileAttachmentsSchema
    .parse(raw)
    .map((ref) =>
      ref.kind === "rendered-pdf" && ref.locale === undefined && messageLocale !== undefined
        ? { ...ref, locale: messageLocale }
        : ref,
    );
}

type AttachmentSource = { readonly ref: EmailAttachmentRef; readonly origin: AttachmentOrigin };

function inlineFileName(cid: string, contentType: string): string {
  const extension = extensionForResourceContentType(contentType);
  return extension === undefined ? cid : `${cid}.${extension}`;
}

async function resolveAttachments(
  sources: readonly AttachmentSource[],
  ctx: ChannelContext,
): Promise<readonly EmailAttachment[]> {
  if (sources.length === 0) return [];
  if (ctx.readAttachment === undefined) {
    throw new Error(
      "email channel: the message has attachments but the channel context cannot read files",
    );
  }
  const resolved: EmailAttachment[] = [];
  for (const { ref, origin } of sources) {
    const found = await ctx.readAttachment(ref, origin);
    if (ref.kind === "rendered-pdf") {
      if (found === null) {
        throw new Error(`email channel: rendering attachment "${ref.fileName}" returned nothing`);
      }
      resolved.push({
        kind: "rendered-pdf",
        templateSlug: ref.templateSlug,
        fileName: ref.fileName,
        content: found.content,
        contentType: found.contentType,
      });
      continue;
    }
    if (found === null) {
      // A missing inline image only degrades the look; a missing file is content the recipient expects.
      if (ref.kind === "inline") continue;
      throw new Error(`email channel: attachment file ${ref.fileRefId} was not found`);
    }
    const fileName =
      ref.kind === "file" ? ref.fileName : inlineFileName(ref.cid, found.contentType);
    resolved.push({ ...ref, fileName, content: found.content, contentType: found.contentType });
  }
  return resolved;
}

export type EmailChannelOptions = {
  readonly transport: EmailTransport;
  readonly resolveEmail: (
    userId: string,
    ctx: { db: unknown; tenantId: TenantId },
  ) => Promise<string | null>;
};

export function createEmailChannel(options: EmailChannelOptions): DeliveryChannel {
  const { transport, resolveEmail } = options;

  // Render runs in the delivery.render job, decoupled from the SMTP send so
  // each can retry independently. Extracted so the inline path (no job runner)
  // can reuse it without going through the channel's own render() indirection.
  async function renderMessage(
    message: ChannelMessage,
    ctx: ChannelContext,
  ): Promise<RenderedMessage> {
    const notificationType = message.notificationType;
    if (ctx.registry.getAllNotifications().get(notificationType)?.template === undefined) {
      throw new Error(
        `email channel: notification "${notificationType}" has no mail template, declare template + meta on r.notification`,
      );
    }
    if (ctx.renderMail === undefined) {
      throw new Error(
        `email channel: notification "${notificationType}" has a mail template but the channel context carries no renderMail`,
      );
    }
    const unsubscribeUrl = message.data?.["unsubscribeUrl"];
    const { subject, html, text, attachments, fromName, replyTo } = await ctx.renderMail({
      slug: notificationType,
      locale: message.locale ?? "en",
      variables: message.data ?? {},
      ...(typeof unsubscribeUrl === "string" && { unsubscribeUrl }),
    });
    return {
      html,
      subject,
      text,
      ...(fromName !== undefined && { fromName }),
      ...(replyTo !== undefined && { replyTo }),
      ...(attachments !== undefined && { attachments }),
    };
  }

  return {
    name: EMAIL_CHANNEL_NAME,
    mode: "queued",

    // resolveEmail typically returns the raw stored user.email, which is ciphertext under an active KMS.
    async resolve(userId, ctx) {
      const stored = await resolveEmail(userId, ctx);
      if (stored === null) return null;
      const address = await decryptStoredPii(stored, "email", "channel-email:resolve");
      return address === PII_ERASED_SENTINEL ? null : address;
    },

    render(message, ctx) {
      return renderMessage(message, ctx);
    },

    async send(address, message, ctx, rendered) {
      const { html, subject, text, attachments, fromName, replyTo } =
        rendered ?? (await renderMessage(message, ctx));
      // Template-level sender defaults; notify data wins.
      const envelope = {
        ...(fromName && { fromName }),
        ...(replyTo && { replyTo }),
        ...emailEnvelopeFrom(message.data),
      };
      const resolvedAttachments = await resolveAttachments(
        [
          ...(attachments ?? []).map((ref): AttachmentSource => ({ ref, origin: "template" })),
          ...fileAttachmentsFrom(message.data, message.locale).map(
            (ref): AttachmentSource => ({ ref, origin: "message" }),
          ),
        ],
        ctx,
      );
      await transport.send(
        guardEmailMessage({
          to: address,
          subject,
          html,
          ...(text !== undefined && { text }),
          ...envelope,
          ...(resolvedAttachments.length > 0 && { attachments: resolvedAttachments }),
        }),
      );
      return { status: "sent", address };
    },
  };
}
