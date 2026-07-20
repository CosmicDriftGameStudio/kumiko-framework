import {
  type AuthProviderPlugin,
  EXT_TOKEN_VERIFIER,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { PAT_TOKEN_PREFIX } from "@cosmicdrift/kumiko-framework/api";
import { buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, PAT_FEATURE, PAT_SCREEN_ID, type PatRateLimit } from "./constants";
import { buildAvailableScopesQuery } from "./handlers/available-scopes.query";
import { createPatWrite } from "./handlers/create.write";
import { listPatQuery } from "./handlers/list.query";
import { revokePatWrite } from "./handlers/revoke.write";
import { PAT_FEATURE_I18N } from "./i18n";
import { createPatResolver } from "./resolver";
import { apiTokenEntity } from "./schema/api-token";
import type { PatScopeConfig } from "./scopes";

export type PersonalAccessTokensOptions = {
  // The scopes this deployment offers. Each is a named bundle of QN globs a PAT
  // may be granted (a scope can span features). Closed over by available-scopes
  // (UI list) and exported so run-prod-app can build the resolver from the same
  // single source.
  readonly scopes: PatScopeConfig;
  // Per-token request rate limit for PAT-authenticated calls. Defaults to
  // PAT_DEFAULT_RATE_LIMIT (120/60s). run-prod-app builds the limiter from this.
  readonly rateLimit?: PatRateLimit;
  /** Make the whole feature tier-gatable via the tier-engine. Use
   *  { default: false } for fail-closed gating (feature off until a tier grants
   *  it). Omit to keep PAT always-on (default). */
  readonly toggleable?: { readonly default: boolean };
};

export type PatFeatureExports = {
  readonly rateLimit: PatRateLimit;
};

// Personal Access Tokens — long-lived, revocable bearer credentials for the
// HTTP API. Like `sessions`, the hot-path resolver is NOT a handler: it runs on
// every PAT-authenticated request and does a direct-DB point-read (see
// createPatResolver / the tokenVerifier extension-point registration below). The dispatcher-side handlers here
// only mint/list/revoke tokens and expose the scope catalog.
export function createPersonalAccessTokensFeature(
  options: PersonalAccessTokensOptions,
): FeatureDefinition {
  const { scopes } = options;
  return defineFeature(PAT_FEATURE, (r) => {
    r.describe(
      "Long-lived, revocable Personal Access Tokens for headless HTTP-API access. Stores SHA-256 token hashes in the `store_api_tokens` direct-write table; the plaintext is returned once at creation. `create`/`revoke`/`mine` manage a user's own tokens and `available-scopes` lists the app-declared scope catalog. Bearer tokens carrying the PAT prefix are resolved before jwt.verify (roles resolved live, granted scopes enforced fail-closed at the API boundary) — registered as an auth-foundation tokenVerifier provider, resolved generically by the middleware. Pass { toggleable: { default: false } } to tier-gate the whole feature.",
    );
    r.uiHints({ displayLabel: "Personal Access Tokens", category: "identity", recommended: true });
    // Opt-in tier-gating (mirrors ledger/tags): when set, the feature declares
    // itself r.toggleable so the dispatcher gate + tier-engine can switch PAT
    // on/off per tenant. { default: false } = fail-closed until a tier grants it.
    if (options.toggleable !== undefined) r.toggleable(options.toggleable);
    // Resolver reads memberships + users on every PAT request to build live
    // roles — make both boot-time deps so a mis-wiring fails validateBoot.
    // auth-foundation owns EXT_TOKEN_VERIFIER, which the useExtension below
    // registers against.
    r.requires("user", "tenant", "auth-foundation");
    // Self-registers as a bearer-auth provider instead of the app wiring a
    // dedicated patResolver callback — the middleware finds it generically
    // via resolveTokenVerifier(), shape-matched by the PAT token prefix.
    r.useExtension(EXT_TOKEN_VERIFIER, "pat", {
      shape: { kind: "prefix", prefix: PAT_TOKEN_PREFIX },
      build: (deps) => createPatResolver({ db: deps.db, scopes }),
    } satisfies AuthProviderPlugin);
    // Direct-write store like store_user_sessions: create/revoke write it, the
    // resolver point-reads it. r.entity would make it a rebuildable projection
    // whose replay (no token events) would wipe every live token (#498/#494).
    r.storeTable(buildEntityTableMeta("api-token", apiTokenEntity, { source: "unmanaged" }), {
      reason: "read_side.api_tokens_direct_write",
      // create.write encrypts `name` via encryptForDirectWrite (#820).
      piiEncryptedOnWrite: true,
    });

    const handlers = {
      create: r.writeHandler(createPatWrite),
      revoke: r.writeHandler(revokePatWrite),
    };
    const queries = {
      mine: r.queryHandler(listPatQuery),
      availableScopes: r.queryHandler(buildAvailableScopesQuery(scopes)),
    };

    // Dormant custom-screen — the client maps PAT_SCREEN_ID to PatTokensScreen;
    // the app places it via r.nav in its logged-in settings area.
    r.screen({
      id: PAT_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "PatTokensScreen" } },
      access: { openToAll: true },
    });
    r.translations({ keys: PAT_FEATURE_I18N });

    // rateLimit flows into feature.exports so run-prod-app builds the
    // limiter from the same declaration — single source of truth. `scopes`
    // is closed over directly by the useExtension build() above and by
    // available-scopes, so it doesn't need to round-trip through exports.
    return {
      handlers,
      queries,
      rateLimit: options.rateLimit ?? PAT_DEFAULT_RATE_LIMIT,
    } satisfies { handlers: unknown; queries: unknown } & PatFeatureExports;
  });
}
