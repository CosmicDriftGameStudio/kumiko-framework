// createInboundMailConnectRoutes — declarative extraRoutes (kumiko-
// framework#3050) the app owner mounts via `extraRoutes` in buildServer.
//
//   GET /api/inbound-mail/connect      (entry:"user" — signed-in caller)
//   GET /inbound-mail/oauth/callback   (entry:"signature" — anonymous,
//                                       outside /api/*; verify() IS the auth,
//                                       trusting only the HMAC-signed state)
//
// Providers register no routes of their own — their oauth block is
// resolved via resolveInboundProviderForKey. The callback trusts ONLY the
// HMAC-verified state (CSRF-/foreign-claiming lock, see oauth-state.ts).

import type {
  ExtraRouteDefinition,
  SignatureExtraRouteDeps,
  SignatureExtraRouteVerifyRequest,
  UserExtraRouteDeps,
} from "@cosmicdrift/kumiko-framework/api";
import { ExtraRouteRejection, signatureRoute } from "@cosmicdrift/kumiko-framework/api";
import type { Context } from "hono";
import {
  INBOUND_MAIL_FOUNDATION_FEATURE,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
  inboundCredentialSecretKey,
} from "./constants";
import { type OAuthStatePayload, signOAuthState, verifyOAuthState } from "./oauth-state";
import { resolveInboundProviderForKey } from "./provider-factory";

const DEFAULT_STATE_TTL_MINUTES = 15;
const DEFAULT_CONNECT_PATH = "/api/inbound-mail/connect";
const DEFAULT_CALLBACK_PATH = "/inbound-mail/oauth/callback";

export type InboundMailConnectRoutesOptions = {
  /** HMAC-secret for the state param (deploy-time env — `scope:"system"`
   *  secrets don't exist in secrets-v1). */
  readonly stateSecret: string;
  /** Absolute callback URL — must match what's registered with the OAuth
   *  provider exactly. */
  readonly callbackUrl: string;
  /** Where the browser redirects after a successful connect. Omitted →
   *  the callback answers with JSON instead (API-/test-mode). */
  readonly successRedirectUrl?: string;
  readonly stateTtlMinutes?: number;
  /** Default "/api/inbound-mail/connect". */
  readonly connectPath?: string;
  /** Default "/inbound-mail/oauth/callback". */
  readonly callbackPath?: string;
};

function errorJson(c: Context, status: 400 | 401 | 404 | 500 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

type VerifiedCallback = { readonly code: string; readonly state: OAuthStatePayload };

function verifyCallbackRequest(
  request: SignatureExtraRouteVerifyRequest,
  stateSecret: string,
): VerifiedCallback {
  const code = request.query["code"] ?? "";
  const rawState = request.query["state"] ?? "";
  if (!code || !rawState) {
    throw new ExtraRouteRejection(
      400,
      { error: { code: "invalid_callback", message: "missing code or state" } },
      "inbound-mail oauth callback missing code or state",
    );
  }
  const verified = verifyOAuthState(rawState, stateSecret);
  if (!verified.ok) {
    throw new ExtraRouteRejection(
      400,
      { error: { code: "invalid_state", message: `state rejected: ${verified.reason}` } },
      `inbound-mail oauth callback state rejected: ${verified.reason}`,
    );
  }
  return { code, state: verified.payload };
}

/** Builds the `entry:"user"`/`entry:"signature"` extraRoute pair. Mount via
 *  `extraRoutes: createInboundMailConnectRoutes(options)`. */
export function createInboundMailConnectRoutes(
  options: InboundMailConnectRoutesOptions,
): readonly ExtraRouteDefinition[] {
  const ttl = options.stateTtlMinutes ?? DEFAULT_STATE_TTL_MINUTES;

  const connectRoute: ExtraRouteDefinition = {
    method: "GET",
    path: options.connectPath ?? DEFAULT_CONNECT_PATH,
    entry: "user",
    handler: async (c: Context, deps: UserExtraRouteDeps): Promise<Response> => {
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
        plugin = resolveInboundProviderForKey({ registry: deps.registry }, providerKey);
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
          tenantId: deps.user.tenantId,
          ownerUserId: scope === "user" ? deps.user.id : null,
          providerKey,
          mailbox,
        },
        ttl,
        options.stateSecret,
      );
      const authorizeUrl = await plugin.oauth.buildAuthorizeUrl(
        { registry: deps.registry },
        { state, redirectUri: options.callbackUrl },
      );
      return c.redirect(authorizeUrl, 302);
    },
  };

  const callbackRoute = signatureRoute<VerifiedCallback>({
    method: "GET",
    path: options.callbackPath ?? DEFAULT_CALLBACK_PATH,
    entry: "signature",
    verify: async (request) => verifyCallbackRequest(request, options.stateSecret),
    handler: async (
      c: Context,
      verified: VerifiedCallback,
      deps: SignatureExtraRouteDeps,
    ): Promise<Response> => {
      const { code, state } = verified;
      const providerCtx = { registry: deps.registry, secrets: deps.secrets, config: undefined };

      let plugin: ReturnType<typeof resolveInboundProviderForKey>;
      try {
        plugin = resolveInboundProviderForKey(providerCtx, state.providerKey);
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
        tokens = await plugin.oauth.exchangeCode(providerCtx, {
          code,
          redirectUri: options.callbackUrl,
        });
      } catch (e) {
        return errorJson(
          c,
          502,
          "token_exchange_failed",
          e instanceof Error ? e.message : String(e),
        );
      }
      if (!tokens.refreshToken) {
        // No refresh token → no server-side sync possible. Consent must
        // request offline_access (or access_type=offline) — the provider's
        // oauth block owns the scopes.
        return errorJson(
          c,
          502,
          "no_refresh_token",
          `provider "${state.providerKey}" returned no refresh token — check the offline-access scope in the provider's oauth.scopes`,
        );
      }

      // Account creation (programmatic SystemUser; the real owner comes from
      // the HMAC-verified state → ownerUserIdOverride).
      const dispatched = await deps.dispatchSystemWrite({
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

      // Refresh-token into the per-account secret slot (Slot = accountId).
      // Access tokens (~1h) are NEVER persisted — refresh-before-poll in the
      // sync path. `deps.secrets` is optional on SignatureExtraRouteDeps —
      // without it the token would be silently lost, so fail loud instead.
      if (!deps.secrets) {
        return errorJson(
          c,
          500,
          "secrets_context_missing",
          `${INBOUND_MAIL_FOUNDATION_FEATURE}: no secrets context wired for the oauth callback route — the refresh token cannot be persisted`,
        );
      }
      await deps.secrets.set(
        state.tenantId,
        inboundCredentialSecretKey(accountId),
        tokens.refreshToken,
        {
          redact: (plaintext) => `${plaintext.slice(0, 4)}…`,
          hint: `OAuth refresh token for inbound mail account ${accountId}`,
        },
      );

      if (options.successRedirectUrl) {
        const target = new URL(options.successRedirectUrl);
        target.searchParams.set("accountId", accountId);
        return c.redirect(target.toString(), 302);
      }
      return c.json({ connected: true, accountId }, 200);
    },
  });

  return [connectRoute, callbackRoute];
}
