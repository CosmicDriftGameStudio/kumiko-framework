// cap-overview — read-only tier/cap-usage visibility per tenant.
//
// **What this feature does:**
//   1. tenant-caps:list query + tenant-cap-list screen — SystemAdmin-only
//      platform-wide table of every tenant's tier, billing status, and
//      usage against a configurable set of caps.
//   2. caps:usage query + my-caps / platform-tenant-caps dashboards —
//      per-tenant usage cards. TenantAdmin sees their own tenant;
//      SystemAdmin can additionally view any tenant via `tenantId`.
//
// **What this feature does NOT do:**
//   - No writes. Reads tier-engine's read_tier_assignments, billing-
//     foundation's read_subscriptions, tenant's read_tenants, plus
//     app-owned usage tables via the caller-supplied `CapSpec` callbacks.
//   - No nav wiring — a separate cut adds `r.nav(...)` entries.
//
// **Boot-Dependencies:** tenant, tier-engine, billing-foundation.
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { CAP_OVERVIEW_FEATURE } from "./constants";
import { createCapsUsageQuery } from "./handlers/caps-usage.query";
import { createTenantCapsListQuery } from "./handlers/tenant-caps-list.query";
import { tenantOptionsQuery } from "./handlers/tenant-options.query";
import { CAP_OVERVIEW_I18N } from "./i18n";
import { createTenantCapListScreen, myCapsScreen, platformTenantCapsScreen } from "./screens";
import type { CapSpec } from "./types";

export type CreateCapOverviewOptions = {
  readonly caps: readonly CapSpec[];
  /** Caps shown as columns on the platform-wide tenant-cap-list screen.
   *  Defaults to the first three caps when omitted. */
  readonly listCaps?: readonly string[];
  /** Options for the tenant-cap-list tier facet. Omitted → no facet — the
   *  engine itself carries no enumerated tier vocabulary to derive one
   *  from (see screens.ts doc). "Filter by tier" was explicitly requested;
   *  omitting `tiers` silently drops that filter, not a supported default. */
  readonly tiers?: readonly string[];
};

export function createCapOverviewFeature(opts: CreateCapOverviewOptions): FeatureDefinition {
  if (opts.caps.length === 0) {
    throw new Error("createCapOverviewFeature: `caps` must not be empty.");
  }
  const capIds = new Set(opts.caps.map((cap) => cap.id));
  const listCaps = opts.listCaps ?? opts.caps.slice(0, 3).map((cap) => cap.id);
  for (const id of listCaps) {
    if (!capIds.has(id)) {
      throw new Error(
        `createCapOverviewFeature: listCaps references unknown cap id "${id}" — known ids: ${[...capIds].join(", ")}`,
      );
    }
  }

  return defineFeature(CAP_OVERVIEW_FEATURE, (r) => {
    r.describe(
      "Read-only visibility into per-tenant tier assignment and cap usage. SystemAdmin gets a platform-wide tenant list with usage bars; TenantAdmin gets their own usage as dashboard cards. Reads tier-engine, billing-foundation, and tenant data plus app-owned usage tables via caller-supplied CapSpec callbacks — never writes.",
    );
    r.uiHints({
      displayLabel: "Cap Overview · Tier & Usage Visibility",
      category: "operations",
      recommended: false,
    });
    r.systemScope();
    r.requires("tenant");
    r.requires("tier-engine");
    r.requires("billing-foundation");

    r.queryHandler(createTenantCapsListQuery(opts.caps, listCaps));
    r.queryHandler(createCapsUsageQuery(opts.caps));
    r.queryHandler(tenantOptionsQuery);

    r.screen(createTenantCapListScreen(opts.caps, listCaps, opts.tiers));
    r.screen(myCapsScreen);
    r.screen(platformTenantCapsScreen);

    r.translations({ keys: CAP_OVERVIEW_I18N });
  });
}
