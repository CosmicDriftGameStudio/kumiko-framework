import { buildEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { PAT_FEATURE } from "./constants";
import { buildAvailableScopesQuery } from "./handlers/available-scopes.query";
import { createPatWrite } from "./handlers/create.write";
import { listPatQuery } from "./handlers/list.query";
import { revokePatWrite } from "./handlers/revoke.write";
import { apiTokenEntity } from "./schema/api-token";
import type { PatScopeConfig } from "./scopes";

export type PersonalAccessTokensOptions = {
  // The scopes this deployment offers. Each is a named bundle of QN globs a PAT
  // may be granted (a scope can span features). Closed over by available-scopes
  // (UI list) and exported so run-prod-app can build the resolver from the same
  // single source.
  readonly scopes: PatScopeConfig;
};

export type PatFeatureExports = {
  readonly scopes: PatScopeConfig;
};

// Personal Access Tokens — long-lived, revocable bearer credentials for the
// HTTP API. Like `sessions`, the hot-path resolver is NOT a handler: it runs on
// every PAT-authenticated request and does a direct-DB point-read (see
// createPatResolver / run-prod-app wiring). The dispatcher-side handlers here
// only mint/list/revoke tokens and expose the scope catalog.
export function createPersonalAccessTokensFeature(
  options: PersonalAccessTokensOptions,
): FeatureDefinition {
  const { scopes } = options;
  return defineFeature(PAT_FEATURE, (r) => {
    r.describe(
      "Long-lived, revocable Personal Access Tokens for headless HTTP-API access. Stores SHA-256 token hashes in the `read_api_tokens` direct-write table; the plaintext is returned once at creation. `create`/`revoke`/`mine` manage a user's own tokens and `available-scopes` lists the app-declared scope catalog. Bearer tokens carrying the PAT prefix are resolved before jwt.verify (roles resolved live, granted scopes enforced fail-closed at the API boundary) — the resolver is wired via run-prod-app, not the dispatcher.",
    );
    r.uiHints({ displayLabel: "Personal Access Tokens", category: "identity", recommended: false });
    // Resolver reads memberships + users on every PAT request to build live
    // roles — make both boot-time deps so a mis-wiring fails validateBoot.
    r.requires("user", "tenant");
    // Direct-write store like read_user_sessions: create/revoke write it, the
    // resolver point-reads it. r.entity would make it a rebuildable projection
    // whose replay (no token events) would wipe every live token (#498/#494).
    r.unmanagedTable(buildEntityTableMeta("api-token", apiTokenEntity), {
      reason: "read_side.api_tokens_direct_write",
    });

    const handlers = {
      create: r.writeHandler(createPatWrite),
      revoke: r.writeHandler(revokePatWrite),
    };
    const queries = {
      mine: r.queryHandler(listPatQuery),
      availableScopes: r.queryHandler(buildAvailableScopesQuery(scopes)),
    };

    // scopes flow into feature.exports so run-prod-app builds the resolver from
    // the same declaration the handlers use — single source of truth.
    return { handlers, queries, scopes } satisfies { handlers: unknown; queries: unknown } & PatFeatureExports;
  });
}
