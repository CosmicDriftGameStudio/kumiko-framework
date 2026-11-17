// tier-engine — pricing-tier mechanics as a regular bundled feature.
//
// **What this feature does:**
//   Stores one tier assignment per platform tenant (the active tier). With
//   `tierMap` in the options, it also resolves the per-tenant feature set via
//   the framework's `tenantTierResolver` extension; the dispatcher feature gate
//   automatically asks the resolver for the active tenant's effective set.
//
// **Two usage modes:**
//   1. `createTierEngineFeature()` without options — storage only (standard CRUD
//      for the tier-assignment entity). Apps can use `composeApp()` or their
//      own logic.
//   2. `createTierEngineFeature({ defaultTier, tierMap })` — complete tier
//      composition for multi-tenant SaaS apps. The framework auto-wires
//      effectiveFeatures through extension pickup.
//
// **Generic over tier values:** the feature knows no concrete `free`/`pro`/etc.
//   tier values. The app defines its tier map.
//
// **Boot dependencies:** config + tenant.

import {
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
  defineQueryHandler,
  type FeatureDefinition,
  parseTenantId,
  SYSTEM_ROLE,
  TENANT_TIER_RESOLVER_EXT,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { registerAutoDefaultTierHook } from "./auto-default-tier-hook.ts";
import type { TierMap } from "./compose-app.ts";
import { tierAssignmentEntity } from "./entity.ts";
import { getActiveTierQuery } from "./handlers/active-tier.query.ts";
import { getTenantTierQuery } from "./handlers/get-tenant-tier.query.ts";
import { createSetTenantTierWrite } from "./handlers/set-tenant-tier.write.ts";
import { createTierFeatureCache } from "./tier-feature-cache.ts";
import type { TrialPolicy } from "./trial.ts";
import { TIER_ADMIN_SCREEN_ID, TIER_ENGINE_FEATURE, TierEngineHandlers } from "./web/constants.ts";
import { TIER_ENGINE_I18N } from "./web/i18n.ts";

const adminAccess = { access: { roles: [SYSTEM_ROLE, "TenantAdmin", "SystemAdmin"] } } as const;
// Tier changes are controlled by the platform and billing: a TenantAdmin must
// never set its own tier, which would allow a free self-upgrade. Writes are
// therefore SystemAdmin-only, while reads (list, get-active-tier) remain visible
// to TenantAdmin. The auto-default hook writes as the system, so it is not subject to
// this handler access. The billing tier sync job runs as the tenant's system user
// (SYSTEM_ROLE), never a TenantAdmin.
const writeAccess = { access: { roles: [SYSTEM_ROLE, "SystemAdmin"] } } as const;

/**
 * Options for createTierEngineFeature. All fields are optional; when all are
 * omitted, the feature provides storage only.
 *
 * @template TCaps - App-specific capability shape. It flows through tierMap,
 * so a future capsFor() resolver returns this exact shape.
 */
export type CreateTierEngineOptions<TCaps extends Readonly<Record<string, unknown>>> = {
  /**
   * Tier name written automatically when a tenant signs up. `tierMap` must
   * contain this tier name; this is validated at boot.
   * When omitted, no tier is assigned automatically and the app writes it
   * manually.
   */
  readonly defaultTier?: string;

  /**
   * App-specific tier map. When set, the feature registers as a plugin for the
   * `tenantTierResolver` extension, so the framework automatically wires
   * effectiveFeatures per tenant.
   * When omitted, no resolver extension is registered; the app must use
   * `composeApp` or its own resolution logic.
   */
  readonly tierMap?: TierMap<TCaps>;

  /**
   * Optional trial phase: each tenant receives the features of `trial.tier` in
   * addition to its stored tier for `durationHours` after creation, then
   * automatically falls back to its stored tier. Requires `tierMap` to contain
   * the trial tier. The result is derived from inserted_at; no stored flag or
   * scheduler is used.
   */
  readonly trial?: TrialPolicy;
};

/**
 * Factory: create a tier-engine feature instance with optional auto-tier-
 * resolution + default-tier-on-signup behavior. Returns FeatureDefinition
 * mountable in run-config.
 */
export function createTierEngineFeature<
  TCaps extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
>(opts: CreateTierEngineOptions<TCaps> = {}): FeatureDefinition {
  return defineFeature(
    TIER_ENGINE_FEATURE,
    (r) => {
      r.describe(
        'Stores a `tier-assignment` entity per tenant (which pricing tier is active) and, when configured with a `TierMap`, registers itself as the `tenantTierResolver` extension so the dispatcher automatically gates `r.toggleable()` features per tenant based on their assigned tier. Call `createTierEngineFeature({ defaultTier, tierMap })` to get full tier composition \u2014 including an `inTransaction` entity hook that atomically writes the default tier when a new tenant is created \u2014 or use `createTierEngineFeature()` without options for storage-only mode when you manage tier assignment yourself via `composeApp`. A SystemAdmin-only `set-tenant-tier` write plus `get-tenant-tier`/`tier-options` reads let an operator assign a tier to ANY tenant manually \u2014 without a billing purchase \u2014 stamping `source: "manual"` so a future Stripe\u2192tier sync won\'t overwrite the grant. Apps surface this via the `tier-admin` screen, which is always registered — in storage-only mode (no `tierMap`) it shows an honest "no tiers configured" message instead of a tier dropdown.',
      );
      r.uiHints({
        displayLabel: "Tier Engine \u00b7 Plan Composition",
        category: "billing",
        recommended: false,
      });
      r.requires({ features: ["config"] });
      r.requires({ features: ["tenant"] });

      r.entity(tierAssignmentEntity);

      const validTierNames = opts.tierMap ? new Set(Object.keys(opts.tierMap)) : undefined;

      // Standard-CRUD via Helper.
      const createTierAssignmentRef = r.writeHandler(
        defineEntityCreateHandler("tier-assignment", tierAssignmentEntity, {
          ...writeAccess,
          agent: { expose: false },
        }),
      );
      const updateTierAssignmentRef = r.writeHandler(
        defineEntityUpdateHandler("tier-assignment", tierAssignmentEntity, {
          ...writeAccess,
          agent: { expose: false },
        }),
      );
      if (validTierNames) {
        r.hook({
          type: "validation",
          target: [createTierAssignmentRef, updateTierAssignmentRef],
          handler: (data) => {
            const changes = data["changes"];
            const isUpdate = isPlainObject(changes);
            const tier = isUpdate ? changes["tier"] : data["tier"];
            if (typeof tier !== "string" || validTierNames.has(tier)) return null;
            return [{ field: isUpdate ? "changes.tier" : "tier", error: "invalid_value" }];
          },
        });
      }

      // Reads.
      r.queryHandler(
        defineEntityListHandler("tier-assignment", tierAssignmentEntity, {
          ...adminAccess,
          description:
            "Lists the tier-assignment rows visible to the caller with tier name and assignment source; use it to see which plan is stored for a tenant.",
        }),
      );
      r.queryHandler(getActiveTierQuery);

      // ── Manual tier grant (SystemAdmin, without billing) ───────────────────────
      // Cross-tenant set and read for the tier-admin screen. tier-options gives
      // the client the app's tier names from the tierMap closure rather than
      // hard-coding them.
      //
      // onAssigned runs after commit (the direct executor write fires no postSave
      // hook). It is late-bound: without tierMap it remains a no-op; the tierMap
      // block below installs the actual cache update and publication.
      const onTierAssigned: { fn: (tenantId: TenantId, tier: string) => void } = { fn: () => {} };
      r.writeHandler(
        createSetTenantTierWrite({
          onAssigned: (tenantId, tier) => onTierAssigned.fn(tenantId, tier),
          validTiers: validTierNames,
        }),
      );
      r.queryHandler(getTenantTierQuery);
      r.queryHandler(
        defineQueryHandler({
          name: "tier-options",
          description:
            "Returns the tier names the application defines in its tier map; use it to find out which values `set-tenant-tier` accepts.",
          schema: z.object({}),
          access: { roles: ["SystemAdmin"] },
          handler: async () => ({ tiers: [...(validTierNames ?? [])] }),
        }),
      );

      // Declarative form for the manual grant. SystemAdmin-only, hard-wired
      // (platform-admin authority, not app-configurable). Apps place it only
      // via r.nav("tier-engine:screen:tier-admin"); tier options are built
      // statically from the tierMap closure. Always registered — even in
      // storage-only mode (no tierMap) — so the screen shows an honest
      // "no tiers configured" message instead of vanishing (samples like
      // use-all-bundled deliberately mount storage-only to screenshot that
      // empty state).
      r.translations({ keys: TIER_ENGINE_I18N });
      r.screen({
        id: TIER_ADMIN_SCREEN_ID,
        type: "actionForm",
        handler: TierEngineHandlers.setTenantTier,
        fields: {
          tenantId: {
            type: "reference",
            entity: "tenant:tenant",
            labelField: "name",
            required: true,
          },
          tier: {
            type: "select",
            options: [...(validTierNames ?? [])],
            required: true,
          },
        },
        layout: {
          sections: [
            {
              fields: ["tenantId", "tier"],
              description: opts.tierMap ? "tier-admin.explainer" : "tier-admin.error.noTiers",
            },
          ],
        },
        submitLabel: "tier-admin.submit",
        successMessage: "tier-admin.success",
        cancelTarget: false,
        description: "tier-admin.screen.subtitle",
        access: { roles: ["SystemAdmin"] },
        // Apps place it via r.nav() (see above) — no nav area to resolve in
        // isolation.
        dormant: true,
      });

      // ───────────────────────────────────────────────────────────────────
      // Resolver extension (only when tierMap is configured)
      // ───────────────────────────────────────────────────────────────────
      // skip: without tierMap the feature provides storage only; resolver and
      // invalidation hooks need tierMap.
      if (!opts.tierMap) return;

      const tierCache = createTierFeatureCache({
        tierMap: opts.tierMap,
        defaultTier: opts.defaultTier,
        trial: opts.trial,
      });
      onTierAssigned.fn = tierCache.applyAssignment;

      // Invalidation: tier-assignment CRUD events (e.g. the billing webhook) update the cache.
      r.hook({
        type: "postSave",
        target: { allOf: "tier-assignment" },
        handler: async (result) => {
          const tenantId = parseTenantId(result.data["tenantId"]);
          const tier = result.data["tier"];
          // skip: a malformed payload (a custom handler bug) skips the cache update
          // instead of throwing, because a hook error must not block the lifecycle
          // pipeline (afterCommit, best-effort side effect).
          if (tenantId === null || typeof tier !== "string") return;
          tierCache.applyAssignment(tenantId, tier);
        },
      });
      r.hook({
        type: "postDelete",
        target: { allOf: "tier-assignment" },
        handler: async (payload) => {
          const tenantId = parseTenantId(payload.data["tenantId"]);
          // skip: same guard semantics as the postSave hook above.
          if (tenantId === null) return;
          tierCache.removeAssignment(tenantId);
        },
      });

      if (opts.defaultTier !== undefined) registerAutoDefaultTierHook(r, opts.defaultTier);

      // Extension-point declaration + self-registration. Same pattern as
      // mail-foundation/file-foundation: the feature declares the extension
      // point AND registers itself as the default plugin. Other features could
      // register there later (e.g. a future toggle-only resolver), but only one
      // plugin wins — see the "single-plugin" comment on findTierResolverUsage.
      r.extendsRegistrar(TENANT_TIER_RESOLVER_EXT, {});
      r.applyExtension({
        name: TENANT_TIER_RESOLVER_EXT,
        entity: TIER_ENGINE_FEATURE,
        ...tierCache.plugin,
      });
    },
    Object.keys(opts).length === 0 ? { dedupeOptions: {} } : undefined,
  );
}
