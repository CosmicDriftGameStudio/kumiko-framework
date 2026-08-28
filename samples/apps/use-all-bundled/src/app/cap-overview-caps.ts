import type { CapSpec } from "@cosmicdrift/kumiko-bundled-features/cap-overview";
import { noteEntryTable } from "@cosmicdrift/kumiko-bundled-features/notes-history";
import { tagEntity } from "@cosmicdrift/kumiko-bundled-features/tags";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";

const tagTable = buildEntityTable("tag", tagEntity);

const NOTE_LIMIT_BY_TIER: Readonly<Record<string, number>> = { free: 10, pro: 100 };
const TAG_LIMIT_BY_TIER: Readonly<Record<string, number>> = { free: 5, pro: 50 };
const DEFAULT_LIMIT = 10;

// Two example caps built from entities this sample already mounts (notes-history,
// tags) — demonstrates the caller-supplied CapSpec contract cap-overview reads
// against, the same shape a real app would provide for its own usage tables.
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
];
