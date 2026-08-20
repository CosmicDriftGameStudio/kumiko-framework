import {
  type AuthProviderPlugin,
  EXT_TOKEN_VERIFIER,
} from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { PAT_TOKEN_PREFIX } from "@cosmicdrift/kumiko-framework/api";
import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_DEFAULT_RATE_LIMIT, PAT_FEATURE, PAT_SCREEN_ID, type PatRateLimit } from "./constants";
import { buildAvailableScopesQuery } from "./handlers/available-scopes.query";
import { type CreatePatOptions, createPatCreateHandler } from "./handlers/create.write";
import { listPatQuery } from "./handlers/list.query";
import { revokePatWrite } from "./handlers/revoke.write";
import { PAT_FEATURE_I18N } from "./i18n";
import { createPatResolver } from "./resolver";
import { apiTokenEntity } from "./schema/api-token";
import type { PatScopeConfig } from "./scopes";

// Password-change is the only field-level trigger — see the postSave hook
// below. MFA-enable/disable is wired separately (auth-mfa's
// revokeAllPatTokens callback, late-bound at app-composition time) since
// that's a different entity ("user-mfa") this feature doesn't own or
// require.
const PAT_REVOKE_TRIGGERING_FIELDS = ["passwordHash"] as const;

export type BindPatAutoRevokeOnPasswordChange = (
  revoker: (userId: string) => Promise<number>,
) => void;

// Reads the late-bind setter off a mounted personal-access-tokens feature's
// exports — run{Prod,Dev}App call this once a concrete db is available,
// mirrors sessions' own bindAutoRevokeFromFeature/bindAutoRevokeOnPasswordChange.
export function bindPatAutoRevokeOnPasswordChangeFromFeature(
  feature: FeatureDefinition,
): BindPatAutoRevokeOnPasswordChange | undefined {
  const exports = feature.exports;
  if (exports && typeof exports === "object" && "bindAutoRevokeOnPasswordChange" in exports) {
    const { bindAutoRevokeOnPasswordChange } = exports as {
      bindAutoRevokeOnPasswordChange: unknown;
    };
    if (typeof bindAutoRevokeOnPasswordChange === "function") {
      // @cast-boundary exports-walk — feature.exports is untyped by design
      return bindAutoRevokeOnPasswordChange as BindPatAutoRevokeOnPasswordChange;
    }
  }
  return undefined;
}

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
  // Opt-in MFA re-auth gate for minting a token — wired via
  // mfaVerifierFromFeature (auth-mfa/feature.ts) at app-composition time. No
  // hard dependency on the optional auth-mfa feature.
  readonly mfaVerifier?: CreatePatOptions["mfaVerifier"];
  // Password-change revoker — same constructor-option-or-late-bind duality as
  // sessions' own autoRevokeOnPasswordChange (bindAutoRevokeOnPasswordChange
  // below wins only if this is unset). Lets tests pass a revoker directly
  // instead of needing a post-setupTestStack bind call.
  readonly autoRevokeOnPasswordChange?: (userId: string) => Promise<number>;
};

export type PatFeatureExports = {
  readonly rateLimit: PatRateLimit;
  readonly bindAutoRevokeOnPasswordChange: BindPatAutoRevokeOnPasswordChange;
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
    r.uiHints({ displayLabel: "Personal Access Tokens", category: "identity", recommended: false });
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
    r.storeTable(deriveEntityTableMeta("api-token", apiTokenEntity, { source: "unmanaged" }), {
      reason: "read_side.api_tokens_direct_write",
      // create.write encrypts `name` via encryptForDirectWrite (#820).
      piiEncryptedOnWrite: true,
    });

    // Password-change auto-revoke — mirrors sessions' own
    // autoRevokeOnPasswordChange postSave hook, including WHY it's a
    // late-bind callback rather than direct ctx.db use: user:write:user:update
    // is r.systemScope()'d (the user aggregate is a systemStream, framework
    // #497), so a postSave hook on "user" gets a poisoned ctx.db here. The
    // concrete revoker is bound once run{Prod,Dev}App has a real db handle.
    let autoRevokeOnPasswordChange = options.autoRevokeOnPasswordChange;
    r.hook("postSave", { allOf: "user" }, async (result) => {
      // skip: nothing bound — same late-bind pattern as sessions/feature.ts
      if (!autoRevokeOnPasswordChange) return;
      // skip: brand-new user, no PATs can exist yet
      if (result.isNew) return;
      // skip: handler didn't touch any revoke-triggering field
      if (!PAT_REVOKE_TRIGGERING_FIELDS.some((field) => result.changes[field] !== undefined)) {
        return;
      }
      await autoRevokeOnPasswordChange(String(result.id));
    });
    const bindAutoRevokeOnPasswordChange: BindPatAutoRevokeOnPasswordChange = (revoker) => {
      // explicit constructor option wins over the runtime binding
      autoRevokeOnPasswordChange ??= revoker;
    };

    const handlers = {
      create: r.writeHandler(createPatCreateHandler({ mfaVerifier: options.mfaVerifier })),
      revoke: r.writeHandler(revokePatWrite),
    };
    const queries = {
      mine: r.queryHandler(listPatQuery),
      availableScopes: r.queryHandler(buildAvailableScopesQuery(scopes)),
    };

    // Dormant custom-screen — the client maps PAT_SCREEN_ID to PatTokensScreen;
    // the app places it via r.nav in its logged-in settings area. dormant:
    // true skips createKumikoApp's missing-client-plugin boot diagnostic
    // (#2025) for apps that don't nav this screen (#2034).
    // kumiko-lint-ignore app-feature-structure Phase-3 conversion tracked in #2312
    r.screen({
      id: PAT_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "PatTokensScreen" } },
      access: { openToAll: true },
      dormant: true,
    });
    r.translations({ keys: PAT_FEATURE_I18N });

    // rateLimit flows into feature.exports so run-prod-app builds the
    // limiter from the same declaration — single source of truth. `scopes`
    // is closed over directly by the useExtension build() above and by
    // available-scopes, so it doesn't need to round-trip through exports.
    return {
      handlers,
      queries,
      bindAutoRevokeOnPasswordChange,
      rateLimit: options.rateLimit ?? PAT_DEFAULT_RATE_LIMIT,
    } satisfies { handlers: unknown; queries: unknown } & PatFeatureExports;
  });
}
