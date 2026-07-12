// createInboundMailConnectRoutes — Hono-Route-Factory die der App-Owner
// via `extraRoutes` in seinem bin/server.ts mountet (Muster
// billing-foundation/webhook-handler.ts).
//
//   GET /inbound-mail/connect          (auth-gated — im authed Bereich mounten)
//   GET /inbound-mail/oauth/callback   (anonymous — MUSS außerhalb /api/*
//                                       liegen, /api ist auth-gated;
//                                       verifiziert user-data-rights §5)
//
// Beispiel bin/server.ts:
//
//   const routes = createInboundMailConnectRoutes({
//     providerCtx: { registry: deps.registry, secrets, config: undefined },
//     dispatchWrite: ({ handlerQn, payload, tenantId }) =>
//       deps.dispatchSystemWrite({ handlerQn, payload, tenantId: tenantId as TenantId }),
//     secrets,
//     stateSecret: env.INBOUND_MAIL_STATE_SECRET,
//     callbackUrl: `${env.PUBLIC_BASE_URL}/inbound-mail/oauth/callback`,
//   });
//   app.get("/api/inbound-mail/connect", routes.connect);      // auth-gated
//   app.get("/inbound-mail/oauth/callback", routes.callback);  // anonymous
//
// Provider registrieren KEINE eigenen Routen — ihr oauth-Block wird über
// resolveInboundProviderForKey aufgelöst. Der Callback vertraut NUR dem
// HMAC-verifizierten state (CSRF-/Fremd-Claiming-Sperre, oauth-state.ts).

import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import type { Context } from "hono";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
} from "./constants";
import { signOAuthState, verifyOAuthState } from "./oauth-state";
import { resolveInboundProviderForKey } from "./provider-factory";
import type { InboundMailContext } from "./types";

const DEFAULT_STATE_TTL_MINUTES = 15;

export type InboundMailConnectRoutesDeps = {
  /** Slim-Context für Provider-Lookups + oauth-Calls (registry Pflicht). */
  readonly providerCtx: InboundMailContext;
  /** Schreibt durch den Standard-Dispatcher mit auto-konstruiertem
   *  SystemUser — muss connect-account als SystemAdmin durchlassen. */
  readonly dispatchWrite: (args: {
    readonly handlerQn: string;
    readonly payload: unknown;
    readonly tenantId: string;
  }) => Promise<{
    readonly isSuccess: boolean;
    readonly data?: unknown;
    readonly error?: unknown;
  }>;
  /** Tenant-Secret-Write für den Refresh-Token (Slot = accountId). */
  readonly secrets: SecretsContext;
  /** HMAC-Secret für den state-Parameter (Deploy-Config aus env —
   *  `scope:"system"`-Secrets existieren in secrets-v1 nicht). */
  readonly stateSecret: string;
  /** Absolute Callback-URL — exakt so beim OAuth-Provider registriert. */
  readonly callbackUrl: string;
  /** Wohin der Browser nach erfolgreichem Connect redirected wird.
   *  Fehlt sie, antwortet der Callback mit JSON (API-/Test-Modus). */
  readonly successRedirectUrl?: string;
  readonly stateTtlMinutes?: number;
};

function errorJson(c: Context, status: 400 | 401 | 404 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

/** Session-User aus dem Hono-Context — vom Auth-Middleware gesetzt. */
function sessionUserOf(c: Context): { id: string; tenantId: string } | undefined {
  const user = c.get("user") as { id?: unknown; tenantId?: unknown } | undefined;
  if (!user || typeof user.id !== "string" || typeof user.tenantId !== "string") return undefined;
  return { id: user.id, tenantId: user.tenantId };
}

export function createInboundMailConnectRoutes(deps: InboundMailConnectRoutesDeps) {
  const ttl = deps.stateTtlMinutes ?? DEFAULT_STATE_TTL_MINUTES;

  const connect = async (c: Context): Promise<Response> => {
    const user = sessionUserOf(c);
    if (!user) {
      return errorJson(c, 401, "unauthenticated", "connect requires a signed-in user");
    }
    const providerKey = c.req.query("provider") ?? "";
    const scope = c.req.query("scope") ?? "";
    const mailbox = c.req.query("mailbox") ?? "";
    if (!providerKey || (scope !== "user" && scope !== "shared") || !mailbox) {
      return errorJson(
        c,
        400,
        "invalid_connect_request",
        `${INBOUND_MAIL_FOUNDATION_FEATURE}: expected ?provider=<key>&scope=user|shared&mailbox=<address>`,
      );
    }

    let plugin: ReturnType<typeof resolveInboundProviderForKey>;
    try {
      plugin = resolveInboundProviderForKey(deps.providerCtx, providerKey);
    } catch (e) {
      return errorJson(
        c,
        404,
        "provider_not_registered",
        e instanceof Error ? e.message : String(e),
      );
    }
    if (!plugin.oauth) {
      return errorJson(
        c,
        400,
        "provider_has_no_oauth_flow",
        `provider "${providerKey}" connects via credentials form (connect-account write-handler), not OAuth`,
      );
    }

    const state = signOAuthState(
      {
        tenantId: user.tenantId,
        ownerUserId: scope === "user" ? user.id : null,
        providerKey,
        mailbox,
      },
      ttl,
      deps.stateSecret,
    );
    const authorizeUrl = await plugin.oauth.buildAuthorizeUrl(deps.providerCtx, {
      state,
      redirectUri: deps.callbackUrl,
    });
    return c.redirect(authorizeUrl, 302);
  };

  const callback = async (c: Context): Promise<Response> => {
    const code = c.req.query("code") ?? "";
    const rawState = c.req.query("state") ?? "";
    if (!code || !rawState) {
      return errorJson(c, 400, "invalid_callback", "missing code or state");
    }
    const verified = verifyOAuthState(rawState, deps.stateSecret);
    if (!verified.ok) {
      return errorJson(c, 400, "invalid_state", `state rejected: ${verified.reason}`);
    }
    const state = verified.payload;

    let plugin: ReturnType<typeof resolveInboundProviderForKey>;
    try {
      plugin = resolveInboundProviderForKey(deps.providerCtx, state.providerKey);
    } catch (e) {
      return errorJson(
        c,
        404,
        "provider_not_registered",
        e instanceof Error ? e.message : String(e),
      );
    }
    if (!plugin.oauth) {
      return errorJson(c, 400, "provider_has_no_oauth_flow", state.providerKey);
    }

    let tokens: Awaited<ReturnType<NonNullable<typeof plugin.oauth>["exchangeCode"]>>;
    try {
      tokens = await plugin.oauth.exchangeCode(deps.providerCtx, {
        code,
        redirectUri: deps.callbackUrl,
      });
    } catch (e) {
      return errorJson(c, 502, "token_exchange_failed", e instanceof Error ? e.message : String(e));
    }
    if (!tokens.refreshToken) {
      // Ohne Refresh-Token kein Server-Sync — Consent muss offline_access
      // (bzw. access_type=offline) anfordern; der Provider-oauth-Block
      // besitzt die Scopes.
      return errorJson(
        c,
        502,
        "no_refresh_token",
        `provider "${state.providerKey}" returned no refresh token — check the offline-access scope in the provider's oauth.scopes`,
      );
    }

    // Account anlegen (programmatic SystemUser; echter Owner kommt aus
    // dem HMAC-verifizierten state → ownerUserIdOverride).
    const dispatched = await deps.dispatchWrite({
      handlerQn: InboundMailFoundationHandlers.connectAccount,
      tenantId: state.tenantId,
      payload: {
        provider: state.providerKey,
        authMethod: InboundMailAuthMethods.oauth,
        displayName: state.mailbox,
        address: state.mailbox,
        scope: state.ownerUserId ? "user" : "shared",
        ownerUserIdOverride: state.ownerUserId,
      },
    });
    if (!dispatched.isSuccess) {
      return errorJson(c, 502, "account_create_failed", JSON.stringify(dispatched.error ?? {}));
    }
    const accountId = (dispatched.data as { accountId?: unknown } | undefined)?.accountId;
    if (typeof accountId !== "string") {
      return errorJson(c, 502, "account_create_failed", "connect-account returned no accountId");
    }

    // Refresh-Token in den per-Account-Secret-Slot (Request-Pfad =
    // voller SecretsContext). Access-Tokens (~1h) werden NIE persistiert
    // — refresh-before-poll im Sync-Pfad.
    await deps.secrets.set(
      state.tenantId,
      inboundCredentialSecretKey(accountId),
      tokens.refreshToken,
      {
        redact: (plaintext) => `${plaintext.slice(0, 4)}…`,
        hint: `OAuth refresh token for inbound mail account ${accountId}`,
      },
    );

    if (deps.successRedirectUrl) {
      const target = new URL(deps.successRedirectUrl);
      target.searchParams.set("accountId", accountId);
      return c.redirect(target.toString(), 302);
    }
    return c.json({ connected: true, accountId }, 200);
  };

  return { connect, callback };
}

export type InboundMailConnectRoutes = ReturnType<typeof createInboundMailConnectRoutes>;
