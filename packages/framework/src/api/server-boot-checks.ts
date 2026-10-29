import { EXT_FILE_PROVIDER, EXT_PRINCIPAL_STATUS } from "../engine/extension-names.ts";
import type { AppContext, Registry } from "../engine/types/index.ts";
import { holdsFileRefs } from "../files/file-field-slots.ts";

import type { createFallbackLogger } from "../logging/index.ts";
import { SHARED_INSTANCE_SENTINEL } from "../pipeline/event-consumer-state.ts";
import { generateId } from "../utils/index.ts";
import type { AuthRoutesConfig } from "./auth-routes.ts";

export type BootLogger = ReturnType<typeof createFallbackLogger>;

// A payload-bucket handler without a resolver would answer every call with a
// 500 at request time; fail at boot instead.
export function assertNoPayloadRateLimitsWithoutResolver(registry: Registry): void {
  const offenders: string[] = [];
  for (const feature of registry.features.values()) {
    for (const [name, handler] of Object.entries(feature.writeHandlers)) {
      if (handler.additionalRateLimits !== undefined) {
        offenders.push(`${feature.name}:write:${name}`);
      }
    }
  }
  // skip: every handler's payload buckets are covered by the resolver
  if (offenders.length === 0) return;
  throw new Error(
    `Handlers declare additionalRateLimits but no RateLimitResolver is configured: ${offenders.join(", ")}. ` +
      "Wire a Redis client on context.redis (or pass context.rateLimit), or drop the payload buckets " +
      "(for the waitlist: emailRateLimits: []).",
  );
}

export function assertFileStorageProviderForFileFields(
  registry: Registry,
  context: AppContext,
): void {
  // File-storage is resolved per-tenant through file-foundation: a mounted
  // `file-provider-*` plugin (inmemory/s3/s3-env) is the single source for
  // uploads, ctx.services.files and the GDPR jobs.
  const hasFileProvider = registry.getExtensionUsages(EXT_FILE_PROVIDER).length > 0;
  // A test/advanced caller may inject the resolver directly on the context
  // (e.g. a static in-memory provider) instead of mounting a provider plugin.
  const hasInjectedResolver = context._fileProviderResolver !== undefined;
  // Hard-fail when the registry declares file/image fields but no provider
  // plugin is mounted — uploads would otherwise fail at the first request
  // instead of at boot. Proves a plugin is mounted, not that each tenant
  // selected one; per-tenant misconfig surfaces via createFileProviderForTenant.
  if (registryDeclaresFileFields(registry) && !hasFileProvider && !hasInjectedResolver) {
    throw new Error(
      "Features declare file/image fields but no file-storage provider is mounted — " +
        "mount `file-foundation` + a `file-provider-*` feature (inmemory/s3/s3-env) and " +
        "select one per tenant via the 'file-foundation:config:provider' config-key.",
    );
  }
}

export function warnSearchableScreensWithoutSearchAdapter(
  registry: Registry,
  context: AppContext,
  bootLog: BootLogger,
): void {
  // A screen whose search box renders (kumiko-screen.tsx gates it on
  // `screen.searchable ?? entity-has-searchable-field`, the same condition
  // as entitiesWithSearchableScreen) sends `payload.search` on every query. Without a
  // context.searchAdapter that throws UnprocessableError at request time
  // — surface the misconfig at boot instead of on the first search.
  // Warn, not throw: unlike missing file-storage (uploads always fail),
  // list screens still work without search: only the search box is broken.
  // Several deployed apps (offlot-app, publicstatus, kumiko-studio,
  // kumiko-enterprise) currently run in exactly this state.
  if (!context.searchAdapter) {
    const unwiredEntities = entitiesWithSearchableScreen(registry);
    if (unwiredEntities.length > 0) {
      bootLog.warn(
        `${unwiredEntities.length} entit${unwiredEntities.length === 1 ? "y" : "ies"} ` +
          `have a searchable list screen but no SearchAdapter is wired on context.searchAdapter: ` +
          `${unwiredEntities.join(", ")}. Search requests against ${unwiredEntities.length === 1 ? "it" : "them"} will fail with a 422 (search_adapter_not_wired) at runtime. ` +
          "Wire a SearchAdapter (e.g. createMeilisearchAdapter) on context.searchAdapter, or remove `searchable: true` from the affected fields.",
      );
    }
  }
}

export function resolveServerInstanceId(
  explicitInstanceId: string | undefined,
  bootLog: BootLogger,
): string {
  // Resolve the per-process instance identifier. Prefer explicit
  // ServerOptions.instanceId (tests, deliberate wiring), fall back to the
  // deploy-env variable, finally a boot-time UUID. Validator rejects the
  // sentinel — a deliberate collision attempt would silently merge this
  // instance's per-instance cursors with the shared-row cursors and
  // deliver events twice to one shard while starving the other.
  const resolvedInstanceId =
    explicitInstanceId ?? process.env["KUMIKO_INSTANCE_ID"] ?? generateId();
  if (resolvedInstanceId === SHARED_INSTANCE_SENTINEL) {
    throw new Error(
      `ServerOptions.instanceId / KUMIKO_INSTANCE_ID cannot equal the reserved sentinel "${SHARED_INSTANCE_SENTINEL}" — ` +
        `pick any other stable string.`,
    );
  }
  // Warn when we fell back to a random UUID. The built-in SSE consumer is
  // delivery="shared" (one cursor for all pods), so it no longer
  // writes a row per instance. The id still labels this process in the
  // app.started event and in per-instance consumers (opt-in delivery), where a
  // fresh id per boot leaves an orphaned cursor-row that pins pruneEvents
  // (retention-guard uses MIN(lastProcessedEventId) across all shards). Silent
  // when explicitInstanceId or KUMIKO_INSTANCE_ID is explicit — those are
  // deliberate choices (the test suite sets KUMIKO_INSTANCE_ID="test-instance").
  const instanceIdWasRandom =
    explicitInstanceId === undefined && !process.env["KUMIKO_INSTANCE_ID"];
  if (instanceIdWasRandom) {
    bootLog.warn(
      `No ServerOptions.instanceId / KUMIKO_INSTANCE_ID set — generated a random UUID (${resolvedInstanceId}). ` +
        `SSE no longer needs a per-instance cursor, but the id labels this process in the app.started event and in per-instance consumers; without a stable id each restart leaves an orphaned cursor-row behind for those and pins events-retention on its last cursor. ` +
        `Set KUMIKO_INSTANCE_ID to the pod name (e.g. from the Kubernetes downward API metadata.name) in production.`,
    );
  }
  return resolvedInstanceId;
}

export function warnUnlimitedSystemScopeFeatures(registry: Registry, bootLog: BootLogger): void {
  // The systemScope default limit only exists once a resolver does, and an app that
  // declared no explicit rateLimit anywhere never gets one auto-wired (wantsL3 stays
  // false) — so its cross-tenant handlers are silently unlimited.
  const unlimitedSystemScopeFeatures = [...registry.features.values()]
    .filter(
      (feature) =>
        feature.systemScope &&
        Object.keys(feature.writeHandlers).length + Object.keys(feature.queryHandlers).length > 0,
    )
    .map((feature) => feature.name);
  if (unlimitedSystemScopeFeatures.length > 0) {
    bootLog.warn(
      `r.systemScope() features have handlers but no RateLimitResolver is configured, ` +
        `so their default rate limit is not enforced: ${unlimitedSystemScopeFeatures.join(", ")}. ` +
        "Wire a Redis client on context.redis and declare rateLimit on at least one handler (or pass " +
        "context.rateLimit) to enable the resolver.",
    );
  }
}

export function assertSinglePrincipalStatusProvider(
  registry: Registry,
  auth: AuthRoutesConfig,
): void {
  // A membershipQuery handler is registered but principalStatus is not provided by exactly
  // one feature — surface that misconfig at boot instead of an InternalError on first login/switch-tenant.
  if (registry.getQueryHandler(auth.membershipQuery)) {
    const principalStatusProviders = registry.getExtensionUsages(EXT_PRINCIPAL_STATUS).length;
    if (principalStatusProviders === 0) {
      throw new Error(
        `[kumiko] auth membershipQuery "${auth.membershipQuery}" is registered but no feature ` +
          'provides the "principalStatus" contract — mount the user feature (tenant switch and sign-in ' +
          "need it to reject blocked principals).",
      );
    }
    if (principalStatusProviders > 1) {
      throw new Error(
        `[kumiko] auth membershipQuery "${auth.membershipQuery}" is registered but ` +
          `${principalStatusProviders} features provide the "principalStatus" contract — exactly one ` +
          "is expected (the bundled user feature already provides it).",
      );
    }
  }
}

// Scans every feature's entities for a file/image/files/images field. Short-
// circuits on the first hit — no need to build a full inventory, we only want
// the yes/no answer for the boot check.
function registryDeclaresFileFields(registry: Registry): boolean {
  for (const feature of registry.features.values()) {
    for (const entity of Object.values(feature.entities ?? {})) {
      for (const field of Object.values(entity.fields)) {
        if (holdsFileRefs(field)) return true;
      }
    }
  }
  return false;
}

// Entities whose entityList screen WOULD render a search box based on
// screen/field config alone: `screen.searchable` wins when set, otherwise
// the box shows iff the entity has ≥1 searchable field. `screen.searchable
// === false` is excluded — the boot-validator (entity-list-screens.ts) only
// allows that on the whitelisted download-attempt-list-style screens, which
// never render the box. This is the config-only half of the rule; the
// client additionally gates on FeatureSchema.searchAdapterMissing
// (set from the same `!options.context.searchAdapter` check in mountSchemaRoute) so the
// box is actually suppressed once this function finds a hit.
function entitiesWithSearchableScreen(registry: Registry): readonly string[] {
  const entities = new Set<string>();
  for (const feature of registry.features.values()) {
    for (const screen of Object.values(feature.screens)) {
      if (screen.type !== "entityList") continue;
      const isSearchable =
        screen.searchable === true ||
        (screen.searchable === undefined && registry.getSearchableFields(screen.entity).length > 0);
      if (isSearchable) entities.add(screen.entity);
    }
  }
  return [...entities];
}
