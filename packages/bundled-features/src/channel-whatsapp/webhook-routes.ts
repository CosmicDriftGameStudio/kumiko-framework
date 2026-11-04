import {
  type ExtraRouteDefinition,
  ExtraRouteRejection,
  type SignatureExtraRouteDeps,
  signatureRoute,
} from "@cosmicdrift/kumiko-framework/api";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { parseTenantId, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Context } from "hono";
import {
  CHANNEL_WHATSAPP_FEATURE,
  WHATSAPP_DEFAULT_WEBHOOK_PATH,
  WHATSAPP_SECRET_KEYS,
  WhatsappHandlers,
} from "./constants.ts";
import { isValidMetaSignature, secretsMatch } from "./meta-signature.ts";
import { normalizeWhatsappWebhook } from "./webhook-normalize.ts";

export type WhatsappWebhookRouteOptions = {
  /** Route path; MUST carry `:tenantId`. The secrets are tenant-scoped, so the tenant is part of the URL. */
  readonly path?: string;
};

type Verified =
  | { readonly kind: "challenge"; readonly challenge: string }
  | { readonly kind: "webhook"; readonly tenantId: TenantId; readonly body: unknown };

const MAX_CHALLENGE_CHARS = 512;
const AUDIT_HANDLER = `${CHANNEL_WHATSAPP_FEATURE}:webhook`;

// Every authentication failure is a plain throw: the framework answers all of them with the
// same 401 body, so a caller cannot tell a bad tenant id, an unknown tenant, a missing secret
// and a wrong signature apart.
class WebhookAuthError extends Error {}

async function readTenantSecret(
  deps: Pick<SignatureExtraRouteDeps, "secrets">,
  tenantIdParam: string | undefined,
  key: string,
): Promise<{ readonly tenantId: TenantId; readonly secret: string }> {
  const tenantId = parseTenantId(tenantIdParam);
  if (tenantId === null) throw new WebhookAuthError("invalid tenant id");
  const revealed = await deps.secrets?.get(tenantId, key, {
    userId: SYSTEM_USER_ID,
    handlerName: AUDIT_HANDLER,
  });
  const secret = revealed?.reveal();
  if (secret === undefined || secret === "") throw new WebhookAuthError("no secret");
  return { tenantId, secret };
}

async function verifyChallenge(
  deps: Pick<SignatureExtraRouteDeps, "secrets">,
  params: Readonly<Record<string, string>>,
  query: Readonly<Record<string, string>>,
): Promise<Verified> {
  const { secret } = await readTenantSecret(
    deps,
    params["tenantId"],
    WHATSAPP_SECRET_KEYS.verifyToken,
  );
  const challenge = query["hub.challenge"];
  const token = query["hub.verify_token"];
  if (
    query["hub.mode"] !== "subscribe" ||
    token === undefined ||
    !secretsMatch(token, secret) ||
    challenge === undefined ||
    challenge === "" ||
    challenge.length > MAX_CHALLENGE_CHARS
  ) {
    throw new WebhookAuthError("verification failed");
  }
  return { kind: "challenge", challenge };
}

async function verifySignedWebhook(
  deps: Pick<SignatureExtraRouteDeps, "secrets">,
  request: {
    readonly rawBody: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly params: Readonly<Record<string, string>>;
  },
): Promise<Verified> {
  const { tenantId, secret } = await readTenantSecret(
    deps,
    request.params["tenantId"],
    WHATSAPP_SECRET_KEYS.appSecret,
  );
  if (!isValidMetaSignature(secret, request.rawBody, request.headers["x-hub-signature-256"])) {
    throw new WebhookAuthError("bad signature");
  }
  try {
    return { kind: "webhook", tenantId, body: JSON.parse(request.rawBody) };
  } catch {
    throw new ExtraRouteRejection(400, {
      error: { code: "whatsapp_webhook_invalid_json", message: "body is not JSON" },
    });
  }
}

type DispatchCounts = { stored: number; duplicate: number; throttled: number; failed: number };

function outcomeOf(data: unknown): keyof Omit<DispatchCounts, "failed"> {
  const outcome =
    data !== null && typeof data === "object" && "outcome" in data ? data.outcome : undefined;
  return outcome === "duplicate" || outcome === "throttled" ? outcome : "stored";
}

async function processWebhook(
  c: Context,
  verified: Extract<Verified, { kind: "webhook" }>,
  deps: SignatureExtraRouteDeps,
): Promise<Response> {
  const { messages, statuses, skipped } = normalizeWhatsappWebhook(
    verified.body,
    Temporal.Now.instant().toString(),
  );
  const counts: DispatchCounts = { stored: 0, duplicate: 0, throttled: 0, failed: 0 };
  const dispatches = [
    ...messages.map((payload) => ({ handlerQn: WhatsappHandlers.receiveMessage, payload })),
    ...statuses.map((payload) => ({ handlerQn: WhatsappHandlers.recordStatus, payload })),
  ];
  // Every item is tried even after a failure: the dedupe makes the redelivery of the
  // already stored ones harmless, and the failed ones get their retry from Meta.
  for (const { handlerQn, payload } of dispatches) {
    const dispatched = await deps.dispatchSystemWrite({
      handlerQn,
      payload,
      tenantId: verified.tenantId,
    });
    if (dispatched.isSuccess) counts[outcomeOf(dispatched.data)] += 1;
    else counts.failed += 1;
  }
  if (counts.failed > 0) {
    return c.json(
      {
        error: {
          code: "whatsapp_webhook_processing_failed",
          message: "Internal error processing the webhook",
        },
      },
      500,
    );
  }
  return c.json({ ...counts, skipped }, 200);
}

/**
 * The two routes Meta needs: GET answers the subscription handshake (`hub.challenge`), POST takes
 * the signed notifications. Mount via `extraRoutes: createWhatsappWebhookRoutes()`.
 */
export function createWhatsappWebhookRoutes(
  options: WhatsappWebhookRouteOptions = {},
): readonly ExtraRouteDefinition[] {
  const path = options.path ?? WHATSAPP_DEFAULT_WEBHOOK_PATH;
  if (!path.includes(":tenantId")) {
    throw new Error(
      `${CHANNEL_WHATSAPP_FEATURE}: the webhook path must carry a :tenantId segment (the secrets are tenant-scoped)`,
    );
  }
  return [
    signatureRoute<Verified>({
      method: "GET",
      path,
      entry: "signature",
      verify: ({ params, query }, deps) => verifyChallenge(deps, params, query),
      handler: (c, verified) =>
        verified.kind === "challenge"
          ? c.text(verified.challenge, 200)
          : c.json({ error: { code: "whatsapp_webhook_unexpected" } }, 400),
    }),
    signatureRoute<Verified>({
      method: "POST",
      path,
      entry: "signature",
      verify: (request, deps) => verifySignedWebhook(deps, request),
      handler: (c, verified, deps) =>
        verified.kind === "webhook"
          ? processWebhook(c, verified, deps)
          : c.json({ error: { code: "whatsapp_webhook_unexpected" } }, 400),
    }),
  ];
}
