// In-memory stand-in for Meta, for tests and local runs: serves the Graph endpoints the client
// calls, records every request and builds webhooks in Meta's wire format. No network involved.
import { parseJsonOrThrow } from "@cosmicdrift/kumiko-framework/utils";
import { WHATSAPP_DEFAULT_WEBHOOK_PATH } from "./constants.ts";
import { signMetaBody } from "./meta-signature.ts";
import type { WhatsappTransport } from "./options.ts";

export type InMemoryMetaRequest = {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
};

export type InMemoryMetaSentMessage = {
  readonly wamid: string;
  readonly phoneNumberId: string;
  readonly authorization: string | null;
  // The JSON body exactly as the Graph API receives it.
  readonly body: Readonly<Record<string, unknown>>;
};

export type InMemoryMetaRejection = {
  readonly httpStatus: number;
  readonly metaCode: number;
};

type SeededMedia = {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
  readonly host: string;
};

export type InMemoryMeta = {
  readonly transport: WhatsappTransport;
  readonly requests: InMemoryMetaRequest[];
  readonly sent: InMemoryMetaSentMessage[];
  seedMedia(
    mediaId: string,
    media: { bytes: Uint8Array<ArrayBuffer>; mimeType: string; host?: string },
  ): void;
  // The next send answers this Graph error instead of a wamid.
  rejectNextSend(rejection: InMemoryMetaRejection): void;
  reset(): void;
};

const MESSAGES_PATH = /^\/v\d+\.\d+\/(\d+)\/messages$/;
const MEDIA_META_PATH = /^\/v\d+\.\d+\/([A-Za-z0-9_-]+)$/;
const MEDIA_BLOB_PATH = /^\/media\/([A-Za-z0-9_-]+)$/;
const DEFAULT_MEDIA_HOST = "lookaside.fbsbx.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function graphError(status: number, code: number): Response {
  return json({ error: { message: "in-memory meta error", type: "OAuthException", code } }, status);
}

export function createInMemoryMeta(): InMemoryMeta {
  const requests: InMemoryMetaRequest[] = [];
  const sent: InMemoryMetaSentMessage[] = [];
  const media = new Map<string, SeededMedia>();
  let nextRejection: InMemoryMetaRejection | undefined;
  let counter = 0;

  function answerSend(
    phoneNumberId: string,
    authorization: string | null,
    rawBody: string,
  ): Response {
    if (nextRejection) {
      const { httpStatus, metaCode } = nextRejection;
      nextRejection = undefined;
      return graphError(httpStatus, metaCode);
    }
    counter += 1;
    const wamid = `wamid.INMEMORY${counter}`;
    const body: Record<string, unknown> = parseJsonOrThrow(rawBody, "in-memory meta request body");
    sent.push({ wamid, phoneNumberId, authorization, body });
    return json({
      messaging_product: "whatsapp",
      contacts: [{ input: String(body["to"]), wa_id: String(body["to"]) }],
      messages: [{ id: wamid }],
    });
  }

  function answerMediaBlob(mediaId: string, hostname: string): Response {
    const seeded = media.get(mediaId);
    if (!seeded || seeded.host !== hostname) return graphError(404, 100);
    return new Response(seeded.bytes, { headers: { "content-type": seeded.mimeType } });
  }

  function answerMediaMetadata(mediaId: string): Response {
    const seeded = media.get(mediaId);
    if (!seeded) return graphError(404, 100);
    return json({
      id: mediaId,
      url: `https://${seeded.host}/media/${mediaId}`,
      mime_type: seeded.mimeType,
      file_size: seeded.bytes.byteLength,
    });
  }

  const transport: WhatsappTransport = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    const authorization = new Headers(init.headers).get("authorization");
    requests.push({ method: init.method ?? "GET", url: rawUrl, authorization });

    const sendMatch = MESSAGES_PATH.exec(url.pathname);
    if (init.method === "POST" && sendMatch) {
      return answerSend(sendMatch[1] ?? "", authorization, String(init.body));
    }
    const blobMatch = MEDIA_BLOB_PATH.exec(url.pathname);
    if (init.method === "GET" && blobMatch)
      return answerMediaBlob(blobMatch[1] ?? "", url.hostname);
    const metaMatch = MEDIA_META_PATH.exec(url.pathname);
    if (init.method === "GET" && metaMatch) return answerMediaMetadata(metaMatch[1] ?? "");
    return graphError(404, 100);
  };

  return {
    transport,
    requests,
    sent,
    seedMedia(mediaId, seeded) {
      media.set(mediaId, { host: DEFAULT_MEDIA_HOST, ...seeded });
    },
    rejectNextSend(rejection) {
      nextRejection = rejection;
    },
    reset() {
      requests.length = 0;
      sent.length = 0;
      media.clear();
      nextRejection = undefined;
      counter = 0;
    },
  };
}

// --- Webhooks in Meta's format -------------------------------------------------------------

export type MetaWebhookMessage = Readonly<Record<string, unknown>>;

export function metaTextMessage(input: {
  readonly from: string;
  readonly wamid: string;
  readonly text: string;
  readonly timestamp?: string;
  readonly contextWamid?: string;
}): MetaWebhookMessage {
  return {
    from: input.from,
    id: input.wamid,
    timestamp: input.timestamp ?? "1762300800",
    type: "text",
    text: { body: input.text },
    ...(input.contextWamid !== undefined && {
      context: { from: "491700000000", id: input.contextWamid },
    }),
  };
}

export function metaButtonReplyMessage(input: {
  readonly from: string;
  readonly wamid: string;
  readonly payload: string;
  readonly title: string;
  readonly contextWamid: string;
  readonly timestamp?: string;
}): MetaWebhookMessage {
  return {
    from: input.from,
    id: input.wamid,
    timestamp: input.timestamp ?? "1762300800",
    type: "interactive",
    context: { from: "491700000000", id: input.contextWamid },
    interactive: { type: "button_reply", button_reply: { id: input.payload, title: input.title } },
  };
}

export function metaMediaMessage(input: {
  readonly from: string;
  readonly wamid: string;
  readonly kind: "audio" | "image";
  readonly mediaId: string;
  readonly mimeType: string;
  readonly timestamp?: string;
}): MetaWebhookMessage {
  return {
    from: input.from,
    id: input.wamid,
    timestamp: input.timestamp ?? "1762300800",
    type: input.kind,
    [input.kind]: { id: input.mediaId, mime_type: input.mimeType },
  };
}

export function metaStatus(input: {
  readonly wamid: string;
  readonly status: string;
  readonly recipient: string;
  readonly timestamp?: string;
  readonly errorCode?: number;
}): Readonly<Record<string, unknown>> {
  return {
    id: input.wamid,
    status: input.status,
    timestamp: input.timestamp ?? "1762300800",
    recipient_id: input.recipient,
    ...(input.errorCode !== undefined && { errors: [{ code: input.errorCode, title: "failed" }] }),
  };
}

export function metaWebhookPayload(input: {
  readonly phoneNumberId: string;
  readonly messages?: readonly MetaWebhookMessage[];
  readonly statuses?: readonly Readonly<Record<string, unknown>>[];
}): Readonly<Record<string, unknown>> {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "491700000000",
                phone_number_id: input.phoneNumberId,
              },
              ...(input.messages && { messages: input.messages }),
              ...(input.statuses && { statuses: input.statuses }),
            },
          },
        ],
      },
    ],
  };
}

export type WebhookTarget = {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
};

/** Posts a payload to the mounted webhook route, signed with the app secret as Meta signs it. */
export function deliverMetaWebhook(
  app: WebhookTarget,
  input: {
    readonly tenantId: string;
    readonly appSecret: string;
    readonly payload: unknown;
    readonly path?: string;
    // Overrides the computed signature header (tests for a wrong or missing signature).
    readonly signatureHeader?: string | null;
  },
): Promise<Response> {
  const rawBody = JSON.stringify(input.payload);
  const signature =
    input.signatureHeader === undefined
      ? signMetaBody(input.appSecret, rawBody)
      : input.signatureHeader;
  return Promise.resolve(
    app.request(
      (input.path ?? WHATSAPP_DEFAULT_WEBHOOK_PATH).replace(":tenantId", input.tenantId),
      {
        method: "POST",
        body: rawBody,
        headers: {
          "content-type": "application/json",
          ...(signature !== null && { "x-hub-signature-256": signature }),
        },
      },
    ),
  );
}

/** Meta's subscription handshake against the mounted webhook route. */
export function requestMetaVerification(
  app: WebhookTarget,
  input: {
    readonly tenantId: string;
    readonly verifyToken: string;
    readonly challenge: string;
    readonly path?: string;
  },
): Promise<Response> {
  const query = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": input.verifyToken,
    "hub.challenge": input.challenge,
  });
  const path = (input.path ?? WHATSAPP_DEFAULT_WEBHOOK_PATH).replace(":tenantId", input.tenantId);
  return Promise.resolve(app.request(`${path}?${query.toString()}`));
}
