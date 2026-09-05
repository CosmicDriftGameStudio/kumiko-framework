import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// Closed vocabulary for the dashboard cards' icon chip — cap-cards-panel.tsx
// holds the matching lucide-react lookup. Small on purpose (YAGNI): extend
// both together when a cap needs a shape not covered here.
export type CapIconKey = "file" | "hash" | "database" | "users" | "mail" | "gauge";

// Consumer-owned cap definition. `usage`/`usageBatch` receive the SAME
// unfiltered system-mode TenantDb the handler itself reads through — the
// callback is responsible for scoping its own app-owned tables by tenantId,
// same obligation the rest of this feature carries (see feature.ts SECURITY
// note).
export type CapSpec = {
  readonly id: string;
  readonly label: string;
  // `null` = unlimited (a pure usage meter: counted but never capped).
  // `<= 0` = not part of this tier — existing, unchanged meaning (usage-math.ts).
  readonly limit: (tier: string) => number | null;
  // `null` means "no measurement exists yet for this cap" (not "0 used") —
  // callers that haven't wired up instrumentation return null instead of a
  // number they don't actually have.
  readonly usage: (db: TenantDb, tenantId: TenantId) => Promise<number | null>;
  // Batched usage lookup for the tenant-caps:list screen — called once per
  // cap with the current page's tenant ids instead of once per (cap, row).
  // Optional: falls back to per-row `usage()` when absent. A tenant absent
  // from the returned map still means 0 (unchanged) — only an explicit
  // `null` value means "not measured".
  readonly usageBatch?: (
    db: TenantDb,
    tenantIds: readonly TenantId[],
  ) => Promise<Map<TenantId, number | null>>;
  readonly unit?: "count" | "mb" | "tokens";
  /** Icon chip on the dashboard cards. Optional — omitted renders the card
   *  without an icon, same as before this field existed. */
  readonly icon?: CapIconKey;
  /** Icon-chip accent — same raw-CSS-value contract as DashboardStatPanel's
   *  `accentColor` (packages/types/src/screen.ts): a theme token
   *  (`var(--color-status-ok)`), not a literal palette hex. Optional. */
  readonly accentColor?: string;
};

export type CapUsageTone = "default" | "warn" | "danger";

export type CapUsage = {
  // `null` means not measured yet — `fraction`/`tone` stay non-nullable
  // (0 / "default") so no consumer needs null-arithmetic to render.
  readonly used: number | null;
  // `limit: null` means unlimited — a pure usage meter with no cap to hit.
  readonly limit: number | null;
  readonly fraction: number;
};

export type CapUsageWithMeta = CapUsage & {
  readonly id: string;
  readonly label: string;
  readonly tone: CapUsageTone;
  readonly percent: number | null;
  readonly icon?: CapIconKey;
  readonly accentColor?: string;
};
