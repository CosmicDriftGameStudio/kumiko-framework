// @runtime client
// Pure string-literal constants — imported by both server (feature.ts,
// handlers/) and client (web/) code. See tier-engine/constants.ts for the
// same convention.

export const CAP_OVERVIEW_FEATURE = "cap-overview" as const;

export const TENANT_CAP_LIST_SCREEN_ID = "tenant-cap-list" as const;
export const MY_CAPS_SCREEN_ID = "my-caps" as const;
export const PLATFORM_TENANT_CAPS_SCREEN_ID = "platform-tenant-caps" as const;

export const CapOverviewQueries = {
  tenantCapsList: "cap-overview:query:tenant-caps:list",
  capsUsage: "cap-overview:query:caps:usage",
  tenantOptions: "cap-overview:query:tenant-options",
} as const;

export const CAP_USAGE_CELL_COMPONENT = "CapUsageCell" as const;
export const CAP_CARDS_PANEL_COMPONENT = "CapCardsPanel" as const;

// Virtual column field name for a cap's usage cell on tenant-cap-list —
// prefixed so it can never collide with a real projection column ("name",
// "tier", "billing").
export function capFieldName(capId: string): string {
  return `cap_${capId}`;
}
