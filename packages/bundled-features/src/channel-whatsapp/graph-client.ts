import { BlockedHostError, egress } from "@cosmicdrift/kumiko-framework/http";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { checkChatWebhookTarget } from "../delivery/index.ts";
import {
  WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS,
  WHATSAPP_BUTTON_TITLE_MAX_CHARS,
  WHATSAPP_MAX_REPLY_BUTTONS,
  WHATSAPP_MAX_TEMPLATE_BUTTONS,
  WHATSAPP_SECRET_KEYS,
  WHATSAPP_TEXT_MAX_CHARS,
} from "./constants.ts";
import {
  type ChannelWhatsappOptions,
  type ResolvedWhatsappOptions,
  resolveWhatsappOptions,
} from "./options.ts";

export type WhatsappSendFailure =
  | { readonly code: "missing_credentials" }
  | { readonly code: "invalid_phone_number_id" }
  | { readonly code: "invalid_recipient" }
  | { readonly code: "invalid_message" }
  | { readonly code: "host_not_allowed" }
  | { readonly code: "timeout" }
  | { readonly code: "unreachable" }
  | { readonly code: "invalid_response" }
  // Meta answered with an error; `metaCode` is its error code (e.g. 131047: outside the 24h window).
  | { readonly code: "rejected"; readonly httpStatus: number; readonly metaCode: number | null };

export type WhatsappSendResult =
  | { readonly ok: true; readonly wamid: string }
  | ({ readonly ok: false } & WhatsappSendFailure);

export type WhatsappMediaFailure =
  | WhatsappSendFailure
  | { readonly code: "invalid_media_id" }
  | { readonly code: "redirect_blocked" }
  | { readonly code: "too_large" };

export type WhatsappMediaResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly mimeType: string }
  | ({ readonly ok: false } & WhatsappMediaFailure);

/** What a send needs from the caller: the tenant and `ctx.services.secrets` of the handler or job. */
export type WhatsappCallContext = {
  readonly tenantId: TenantId;
  readonly secrets: SecretsContext | undefined;
};

type SendBase = {
  // The sending number; one WhatsApp Business account can own several, so it is never config.
  readonly phoneNumberId: string;
  readonly to: string;
  // wamid of the message this one answers (shown as a quoted reply).
  readonly replyToWamid?: string;
};

export type WhatsappTextInput = SendBase & { readonly text: string };
export type WhatsappTemplateInput = SendBase & {
  readonly templateName: string;
  readonly languageCode: string;
  readonly bodyParameters?: readonly string[];
  // One payload per quick-reply button, echoed back as `buttonPayload`. Meta's button `index` is the
  // position among all template buttons: quick-reply buttons must be the first ones; payload i goes to button index i.
  readonly quickReplyPayloads?: readonly string[];
  readonly headerImageLink?: string;
};
export type WhatsappReplyButton = {
  // Echoed back unchanged in the `buttonPayload` of the answering message.
  readonly payload: string;
  readonly title: string;
};
export type WhatsappButtonsInput = SendBase & {
  readonly text: string;
  readonly buttons: readonly WhatsappReplyButton[];
};
export type WhatsappMediaInput = SendBase & {
  readonly kind: "image";
  readonly link: string;
  readonly caption?: string;
};

export type WhatsappClient = {
  sendText(ctx: WhatsappCallContext, input: WhatsappTextInput): Promise<WhatsappSendResult>;
  sendTemplate(ctx: WhatsappCallContext, input: WhatsappTemplateInput): Promise<WhatsappSendResult>;
  sendButtons(ctx: WhatsappCallContext, input: WhatsappButtonsInput): Promise<WhatsappSendResult>;
  sendMedia(ctx: WhatsappCallContext, input: WhatsappMediaInput): Promise<WhatsappSendResult>;
  fetchMedia(ctx: WhatsappCallContext, mediaId: string): Promise<WhatsappMediaResult>;
};

const PHONE_NUMBER_ID_PATTERN = /^\d{1,32}$/;
const RECIPIENT_PATTERN = /^\+?\d{5,20}$/;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;
const SECRET_AUDIT_HANDLER = "channel-whatsapp:graph-client";

type GraphOutcome =
  | { readonly ok: true; readonly response: Response }
  | ({ readonly ok: false } & WhatsappSendFailure);

type AccessTokenOutcome =
  | { readonly ok: true; readonly token: string }
  | ({ readonly ok: false } & Extract<
      WhatsappSendFailure,
      { readonly code: "missing_credentials" | "unreachable" }
    >);

// Only an absent or empty secret is missing_credentials; a failing secret store is a transient fault.
async function readAccessToken(ctx: WhatsappCallContext): Promise<AccessTokenOutcome> {
  try {
    const revealed = await ctx.secrets?.get(ctx.tenantId, WHATSAPP_SECRET_KEYS.accessToken, {
      userId: SYSTEM_USER_ID,
      handlerName: SECRET_AUDIT_HANDLER,
    });
    const token = revealed?.reveal();
    return token === undefined || token === ""
      ? { ok: false, code: "missing_credentials" }
      : { ok: true, token };
  } catch {
    return { ok: false, code: "unreachable" };
  }
}

// The link is fetched by Meta, not by us, so no allowlist applies; it must still be a plain URL.
function isPublicMediaLink(link: string, requireHttps: boolean): boolean {
  try {
    const parsed = new URL(link);
    const protocolAllowed =
      parsed.protocol === "https:" || (!requireHttps && parsed.protocol === "http:");
    return protocolAllowed && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

function classifyTransportError(err: unknown): WhatsappSendFailure {
  if (err instanceof BlockedHostError) return { code: "host_not_allowed" };
  return { code: isTimeout(err) ? "timeout" : "unreachable" };
}

export function createWhatsappClient(options: ChannelWhatsappOptions = {}): WhatsappClient {
  return buildWhatsappClient(resolveWhatsappOptions(options));
}

export function buildWhatsappClient(resolved: ResolvedWhatsappOptions): WhatsappClient {
  const target = {
    allowedHosts: resolved.allowedHosts,
    requireHttps: resolved.requireHttps,
  };

  // The host and https check runs before any transport, so a swapped transport cannot
  // route the bearer token to a host outside the allowlist.
  async function callGraph(
    url: string,
    token: string,
    init: { readonly method: "GET" | "POST"; readonly body?: unknown },
  ): Promise<GraphOutcome> {
    const checked = checkChatWebhookTarget(target, url);
    if (!checked) return { ok: false, code: "host_not_allowed" };
    try {
      const send =
        resolved.transport ??
        egress(
          resolved.requireHttps
            ? { kind: "external" }
            : { kind: "internal", allowOrigins: [checked.origin] },
        );
      const response = await send(checked.toString(), {
        method: init.method,
        redirect: "manual",
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined && { "content-type": "application/json" }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(resolved.timeoutMs),
      });
      return { ok: true, response };
    } catch (err) {
      return { ok: false, ...classifyTransportError(err) };
    }
  }

  type MediaAnnouncement =
    | { readonly ok: true; readonly url: string; readonly mimeType: string | undefined }
    | ({ readonly ok: false } & WhatsappSendFailure);

  async function readMediaAnnouncement(response: Response): Promise<MediaAnnouncement> {
    try {
      const body = await response.json();
      const url = propertyOf(body, "url");
      const mimeType = propertyOf(body, "mime_type");
      if (typeof url !== "string") return { ok: false, code: "invalid_response" };
      return { ok: true, url, mimeType: typeof mimeType === "string" ? mimeType : undefined };
    } catch {
      return { ok: false, code: "invalid_response" };
    }
  }

  type BoundedBytes =
    | { readonly ok: true; readonly bytes: Uint8Array }
    | ({ readonly ok: false } & WhatsappMediaFailure);

  async function readBoundedBytes(response: Response, maxBytes: number): Promise<BoundedBytes> {
    const announcedLength = Number(response.headers.get("content-length"));
    if (announcedLength > maxBytes) return { ok: false, code: "too_large" };
    try {
      if (!response.body) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return bytes.byteLength > maxBytes ? { ok: false, code: "too_large" } : { ok: true, bytes };
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, code: "too_large" };
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, bytes };
    } catch (err) {
      return { ok: false, ...classifyTransportError(err) };
    }
  }

  async function rejection(response: Response): Promise<WhatsappSendFailure> {
    let metaCode: number | null = null;
    try {
      const code = propertyOf(propertyOf(await response.json(), "error"), "code");
      metaCode = typeof code === "number" ? code : null;
    } catch {
      metaCode = null;
    }
    return { code: "rejected", httpStatus: response.status, metaCode };
  }

  async function postMessage(
    ctx: WhatsappCallContext,
    base: SendBase,
    content: Readonly<Record<string, unknown>>,
  ): Promise<WhatsappSendResult> {
    if (!PHONE_NUMBER_ID_PATTERN.test(base.phoneNumberId)) {
      return { ok: false, code: "invalid_phone_number_id" };
    }
    if (!RECIPIENT_PATTERN.test(base.to)) return { ok: false, code: "invalid_recipient" };
    const credentials = await readAccessToken(ctx);
    if (!credentials.ok) return credentials;

    const outcome = await callGraph(
      `${resolved.apiBaseUrl}/${resolved.apiVersion}/${base.phoneNumberId}/messages`,
      credentials.token,
      {
        method: "POST",
        body: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: base.to.replace(/^\+/, ""),
          ...(base.replyToWamid !== undefined && { context: { message_id: base.replyToWamid } }),
          ...content,
        },
      },
    );
    if (!outcome.ok) return outcome;
    if (!outcome.response.ok) return { ok: false, ...(await rejection(outcome.response)) };
    try {
      const messages = propertyOf(await outcome.response.json(), "messages");
      const wamid = Array.isArray(messages) ? propertyOf(messages[0], "id") : undefined;
      return typeof wamid === "string" && wamid !== ""
        ? { ok: true, wamid }
        : { ok: false, code: "invalid_response" };
    } catch {
      return { ok: false, code: "invalid_response" };
    }
  }

  async function fetchMedia(
    ctx: WhatsappCallContext,
    mediaId: string,
  ): Promise<WhatsappMediaResult> {
    if (!MEDIA_ID_PATTERN.test(mediaId)) return { ok: false, code: "invalid_media_id" };
    const credentials = await readAccessToken(ctx);
    if (!credentials.ok) return credentials;
    const { token } = credentials;

    const meta = await callGraph(
      `${resolved.apiBaseUrl}/${resolved.apiVersion}/${mediaId}`,
      token,
      { method: "GET" },
    );
    if (!meta.ok) return meta;
    if (!meta.response.ok) return { ok: false, ...(await rejection(meta.response)) };
    const announced = await readMediaAnnouncement(meta.response);
    if (!announced.ok) return announced;

    // The URL comes from the Graph answer and receives the bearer token: callGraph checks
    // it against the same allowlist and https rule before anything is sent.
    const download = await callGraph(announced.url, token, { method: "GET" });
    if (!download.ok) return download;
    const { response } = download;
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, code: "redirect_blocked" };
    }
    if (!response.ok) return { ok: false, ...(await rejection(response)) };
    const body = await readBoundedBytes(response, resolved.mediaMaxBytes);
    if (!body.ok) return body;
    const mimeType =
      announced.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream";
    return { ok: true, bytes: body.bytes, mimeType };
  }

  return {
    sendText: (ctx, input) => {
      if (input.text === "" || input.text.length > WHATSAPP_TEXT_MAX_CHARS) {
        return Promise.resolve({ ok: false, code: "invalid_message" });
      }
      return postMessage(ctx, input, {
        type: "text",
        text: { body: input.text, preview_url: false },
      });
    },

    sendTemplate: (ctx, input) => {
      if (
        !TEMPLATE_NAME_PATTERN.test(input.templateName) ||
        !LANGUAGE_CODE_PATTERN.test(input.languageCode)
      ) {
        return Promise.resolve({ ok: false, code: "invalid_message" });
      }
      const quickReplyPayloads = input.quickReplyPayloads;
      if (
        quickReplyPayloads !== undefined &&
        (quickReplyPayloads.length === 0 ||
          quickReplyPayloads.length > WHATSAPP_MAX_TEMPLATE_BUTTONS ||
          quickReplyPayloads.some(
            (payload) => payload === "" || payload.length > WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS,
          ))
      ) {
        return Promise.resolve({ ok: false, code: "invalid_message" });
      }
      if (input.headerImageLink !== undefined && !isPublicMediaLink(input.headerImageLink, true)) {
        return Promise.resolve({ ok: false, code: "invalid_message" });
      }
      const parameters = (input.bodyParameters ?? []).map((text) => ({ type: "text", text }));
      const components = [
        ...(input.headerImageLink !== undefined
          ? [
              {
                type: "header",
                parameters: [{ type: "image", image: { link: input.headerImageLink } }],
              },
            ]
          : []),
        ...(parameters.length > 0 ? [{ type: "body", parameters }] : []),
        ...(quickReplyPayloads ?? []).map((payload, index) => ({
          type: "button",
          sub_type: "quick_reply",
          index: String(index),
          parameters: [{ type: "payload", payload }],
        })),
      ];
      return postMessage(ctx, input, {
        type: "template",
        template: {
          name: input.templateName,
          language: { code: input.languageCode },
          ...(components.length > 0 && { components }),
        },
      });
    },

    sendButtons: (ctx, input) => {
      const invalid =
        input.text === "" ||
        input.text.length > WHATSAPP_TEXT_MAX_CHARS ||
        input.buttons.length === 0 ||
        input.buttons.length > WHATSAPP_MAX_REPLY_BUTTONS ||
        input.buttons.some(
          ({ payload, title }) =>
            payload === "" ||
            payload.length > WHATSAPP_BUTTON_PAYLOAD_MAX_CHARS ||
            title === "" ||
            title.length > WHATSAPP_BUTTON_TITLE_MAX_CHARS,
        );
      if (invalid) return Promise.resolve({ ok: false, code: "invalid_message" });
      return postMessage(ctx, input, {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: input.text },
          action: {
            buttons: input.buttons.map(({ payload, title }) => ({
              type: "reply",
              reply: { id: payload, title },
            })),
          },
        },
      });
    },

    sendMedia: (ctx, input) => {
      if (!isPublicMediaLink(input.link, resolved.requireHttps)) {
        return Promise.resolve({ ok: false, code: "invalid_message" });
      }
      return postMessage(ctx, input, {
        type: input.kind,
        [input.kind]: {
          link: input.link,
          ...(input.caption !== undefined && { caption: input.caption }),
        },
      });
    },

    fetchMedia,
  };
}
