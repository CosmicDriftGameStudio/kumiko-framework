import { access, type ScreenDefinition } from "@cosmicdrift/kumiko-framework/engine";
import {
  CAP_CARDS_PANEL_COMPONENT,
  CAP_USAGE_CELL_COMPONENT,
  CapOverviewQueries,
  capFieldName,
  MY_CAPS_SCREEN_ID,
  PLATFORM_TENANT_CAPS_SCREEN_ID,
  TENANT_CAP_LIST_SCREEN_ID,
} from "./constants";
import type { CapSpec } from "./types";

// `tiers` has no room for a separate per-tier display label (it's just
// `readonly string[]`) — tier-engine itself has no enumerated tier list to
// derive one from either (it's generic over tier values, see tier-engine's
// own doc comment). The tier string is used verbatim as the facet option
// label, same as how tier values already surface untranslated elsewhere
// (tier-engine's TierMap keys).
export function createTenantCapListScreen(
  caps: readonly CapSpec[],
  listCaps: readonly string[],
  tiers?: readonly string[],
): ScreenDefinition {
  const listedCaps = caps.filter((cap) => listCaps.includes(cap.id));

  return {
    id: TENANT_CAP_LIST_SCREEN_ID,
    type: "projectionList",
    query: CapOverviewQueries.tenantCapsList,
    columns: [
      { field: "name", label: "cap-overview.list.col.name" },
      { field: "tier", label: "cap-overview.list.col.tier" },
      { field: "billing", label: "cap-overview.list.col.billing" },
      ...listedCaps.map((cap) => ({
        field: capFieldName(cap.id),
        label: cap.label,
        renderer: { react: { __component: CAP_USAGE_CELL_COMPONENT } },
      })),
    ],
    searchable: true,
    ...(tiers !== undefined &&
      tiers.length > 0 && {
        facets: [
          {
            field: "tier",
            type: "select" as const,
            label: "cap-overview.list.filter.tier",
            options: tiers.map((tier) => ({ value: tier, label: tier })),
          },
        ],
      }),
    // params.map's key ("tenantId") must match platform-tenant-caps's own
    // `filter.id` — that's how useFilterParams (dashboard-body.tsx) seeds
    // the tenant filter from the URL on arrival, landing straight on the
    // clicked tenant's dashboard instead of an empty one (boot-validated).
    rowActions: [
      {
        kind: "navigate" as const,
        id: "open-dashboard",
        label: "cap-overview.list.action.open",
        screen: PLATFORM_TENANT_CAPS_SCREEN_ID,
        params: { map: { tenantId: "tenantId" } },
        rowClick: true,
      },
    ],
    defaultSort: { field: "name", dir: "asc" },
    access: { roles: ["SystemAdmin"] },
  };
}

export const myCapsScreen: ScreenDefinition = {
  id: MY_CAPS_SCREEN_ID,
  type: "dashboard",
  panels: [
    {
      kind: "custom",
      id: "cap-cards",
      component: { react: { __component: CAP_CARDS_PANEL_COMPONENT } },
    },
  ],
  access: { roles: access.admin },
};

export const platformTenantCapsScreen: ScreenDefinition = {
  id: PLATFORM_TENANT_CAPS_SCREEN_ID,
  type: "dashboard",
  panels: [
    {
      kind: "custom",
      id: "cap-cards",
      component: { react: { __component: CAP_CARDS_PANEL_COMPONENT } },
    },
  ],
  filter: {
    id: "tenantId",
    label: "cap-overview.platform.filter.tenant",
    kind: "select",
    optionsQuery: CapOverviewQueries.tenantOptions,
  },
  access: { roles: ["SystemAdmin"] },
};
