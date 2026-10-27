// createInboundMailConnectRoutes — declarative extraRoutes the app owner mounts
// via `extraRoutes` in buildServer.
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
  UserExtraRouteDeps,
} from "@cosmicdrift/kumiko-framework/api";
import { signatureRoute } from "@cosmicdrift/kumiko-framework/api";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { Context } from "hono";
import {
  refreshTokenOrRefusal,
  type VerifiedCallback,
  verifyCallbackRequest,
} from "./connect-callback-verify.ts";
import { connectFailureResponse, errorJson } from "./connect-route-responses.ts";
import {
  INBOUND_MAIL_CONNECT_PATH,
  INBOUND_MAIL_FOUNDATION_FEATURE,
  InboundMailAuthMethods,
  InboundMailFoundationHandlers,
} from "./constants.ts";
import { isMailAdmin } from "./handlers/scope-visibility.ts";
import { readInboundMailRoles } from "./mail-roles.ts";
import {
  type OAuthAccessTokenManager,
  storeOAuthCallbackCredential,
} from "./oauth-access-token.ts";
import { signOAuthState } from "./oauth-state.ts";
import { resolveInboundProviderForKey } from "./provider-factory.ts";
import type { InboundMailContext } from "./types.ts";

const DEFAULT_STATE_TTL_MINUTES = 15;
const DEFAULT_CALLBACK_PATH = "/inbound-mail/oauth/callback";

// connect-account leaves a reopened mailbox off: switched on before its token is stored, the
// supervisor would sync it with the old, failing credential.
async function reactivateIfReopened(
  c: Context,
  deps: SignatureExtraRouteDeps,
  tenantId: string,
  accountId: string,
  connected: unknown,
): Promise<Response | undefined> {
  if (propertyOf(connected, "reconnected") !== true) return undefined;
  const reactivated = await deps.dispatchSystemWrite({
    handlerQn: InboundMailFoundationHandlers.reactivateAccount,
    tenantId,
    payload: { accountId },
  });
  return reactivated.isSuccess ? undefined : connectFailureResponse(c, reactivated.error);
}

// The callback connects as a system user, so connect-account's role rules (mail member at all,
// admin for a shared mailbox) have to hold here, before the signed state is handed out.
function connectRoleRefusal(
  c: Context,
  deps: UserExtraRouteDeps,
  scope: "user" | "shared",
): Response | undefined {
  const { memberRoles, adminRoles } = readInboundMailRoles(deps.registry);
  if (!memberRoles.some((role) => deps.user.roles.includes(role))) {
    return errorJson(
      c,
      403,
      "mail_role_required",
      `${INBOUND_MAIL_FOUNDATION_FEATURE}: connecting a mailbox needs one of the roles ${memberRoles.join(", ")}`,
    );
  }
  if (scope === "shared" && !isMailAdmin(deps.user, adminRoles)) {
    return errorJson(
      c,
      403,
      "shared_mailbox_requires_admin",
      `${INBOUND_MAIL_FOUNDATION_FEATURE}: only ${adminRoles.join(", ")} connect a shared mailbox`,
    );
  }
  return undefined;
}

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
  /** Apps wire the supervisor and these routes separately, so build ONE
   *  manager (`createOAuthAccessTokenManager`) and share it with `createInboundMailSupervisor({ oauthTokens })`:
   *  the callback then writes the refresh token under the account's refresh
   *  lock and primes the access-token cache from the code exchange. Omitted
   *  → plain secret write, no cache priming. */
  readonly oauthTokens?: OAuthAccessTokenManager;
  /** Handed to the provider plugin's context (`InboundMailContext.metricsFor`). */
  readonly metricsFor?: InboundMailContext["metricsFor"];
};

/** Builds the `entry:"user"`/`entry:"signature"` extraRoute pair. Mount via
 *  `extraRoutes: createInboundMailConnectRoutes(options)`. */
export function createInboundMailConnectRoutes(
  options: InboundMailConnectRoutesOptions,
): readonly ExtraRouteDefinition[] {
  const ttl = options.stateTtlMinutes ?? DEFAULT_STATE_TTL_MINUTES;

  const connectRoute: ExtraRouteDefinition = {
    method: "GET",
    path: options.connectPath ?? INBOUND_MAIL_CONNECT_PATH,
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

      const refused = connectRoleRefusal(c, deps, scope);
      if (refused) return refused;

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
      // Checked before exchangeCode/connectAccount: the code is single-use and
      // an account created without a persistable refresh token is an orphan.
      // `deps.secrets` is optional on SignatureExtraRouteDeps.
      if (!deps.secrets) {
        return errorJson(
          c,
          500,
          "secrets_context_missing",
          `${INBOUND_MAIL_FOUNDATION_FEATURE}: no secrets context wired for the oauth callback route — the refresh token cannot be persisted`,
        );
      }
      const providerCtx: InboundMailContext = {
        registry: deps.registry,
        secrets: deps.secrets,
        config: undefined,
        ...(options.metricsFor && { metricsFor: options.metricsFor }),
      };

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
      } catch {
        // Provider error messages can carry token/response data — code only.
        return errorJson(
          c,
          502,
          "token_exchange_failed",
          "token exchange with the provider failed",
        );
      }
      const refreshToken = refreshTokenOrRefusal(c, state, tokens);
      if (typeof refreshToken !== "string") return refreshToken;

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
        return connectFailureResponse(c, dispatched.error);
      }
      const accountId = propertyOf(dispatched.data, "accountId");
      if (typeof accountId !== "string") {
        return errorJson(c, 502, "account_create_failed", "connect-account returned no accountId");
      }

      try {
        await storeOAuthCallbackCredential(
          options.oauthTokens,
          deps.secrets,
          { id: accountId, tenantId: state.tenantId },
          tokens,
          refreshToken,
        );
      } catch {
        return errorJson(
          c,
          502,
          "credential_store_failed",
          "the sign-in worked but its token could not be saved; the mailbox keeps its previous state, connect it again",
        );
      }
      const refused = await reactivateIfReopened(
        c,
        deps,
        state.tenantId,
        accountId,
        dispatched.data,
      );
      if (refused) return refused;

      // Best effort: the account commit already woke the supervisor before the token existed.
      // Without this event the first sync would wait for the next poll tick; a failure here
      // only costs that delay, so the connect itself still succeeds.
      await deps.dispatchSystemWrite({
        handlerQn: InboundMailFoundationHandlers.markCredentialStored,
        tenantId: state.tenantId,
        payload: { accountId },
      });

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
