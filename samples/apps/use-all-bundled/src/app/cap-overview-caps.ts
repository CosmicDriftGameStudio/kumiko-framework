import type { CapSpec } from "@cosmicdrift/kumiko-bundled-features/cap-overview";
import { noteEntryTable } from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { tagEntity } from "@cosmicdrift/kumiko-bundled-features/tags";
import { tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";

const tagTable = buildEntityTable("tag", tagEntity);

const NOTE_LIMIT_BY_TIER: Readonly<Record<string, number>> = { free: 10, pro: 100 };
const TAG_LIMIT_BY_TIER: Readonly<Record<string, number>> = { free: 5, pro: 50 };
const SEAT_LIMIT_BY_TIER: Readonly<Record<string, number>> = { free: 5, pro: 20 };
const DEFAULT_LIMIT = 10;

// Four example caps built from entities this sample already mounts
// (notes-history, tags, tenant-membership) — demonstrates the caller-supplied
// CapSpec contract cap-overview reads against, the same shape a real app
// would provide for its own usage tables.
export const CAP_OVERVIEW_CAPS: readonly CapSpec[] = [
  {
    id: "notes",
    label: "cap-overview.caps.notes",
    limit: (tier) => NOTE_LIMIT_BY_TIER[tier] ?? DEFAULT_LIMIT,
    usage: async (db, tenantId) => {
      const rows = await selectMany(db, noteEntryTable, { tenantId: [tenantId] });
      return rows.length;
    },
    icon: "file",
  },
  {
    id: "tags",
    label: "cap-overview.caps.tags",
    limit: (tier) => TAG_LIMIT_BY_TIER[tier] ?? DEFAULT_LIMIT,
    usage: async (db, tenantId) => {
      const rows = await selectMany(db, tagTable, { tenantId: [tenantId] });
      return rows.length;
    },
    icon: "hash",
    accentColor: "var(--color-status-ok)",
  },
  {
    id: "seats",
    label: "cap-overview.caps.seats",
    limit: (tier) => SEAT_LIMIT_BY_TIER[tier] ?? DEFAULT_LIMIT,
    usage: async (db, tenantId) => {
      const rows = await selectMany(db, tenantMembershipsTable, { tenantId: [tenantId] });
      return rows.length;
    },
    icon: "users",
  },
  {
    // Unlimited usage meter: counted but never capped, no percent/badge.
    id: "apiCalls",
    label: "cap-overview.caps.apiCalls",
    limit: () => null,
    usage: async (db, tenantId) => {
      const rows = await selectMany(db, noteEntryTable, { tenantId: [tenantId] });
      return rows.length;
    },
    icon: "gauge",
  },
];
