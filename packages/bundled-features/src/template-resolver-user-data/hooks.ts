// EXT_USER_DATA hooks for the template-resolver's `user-content-entry` entity
// (GDPR Art. 20 export / Art. 17 erasure). Lives apart from template-resolver
// so apps without the user-data-rights pipeline don't pull a hard dependency.
// Mirrors notes-history-user-data: export-only, erasure via crypto-shredding.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { userContentEntriesTable } from "../template-resolver";

// Genuinely per-user content — the export filters by ownerId alone. Tenant
// scoping comes from the tenant-scoped ctx.db; a user who belongs to two
// tenants gets each tenant's entries from that tenant's forget run.
export const userContentExportHook: UserDataExportHook = async (ctx) => {
  const rows = await selectMany<Record<string, unknown>>(ctx.db, userContentEntriesTable, {
    ownerId: ctx.userId,
  });
  if (rows.length === 0) return null;
  return {
    entity: "user-content-entry",
    rows: rows.map((r) => ({
      slug: r["slug"],
      kind: r["kind"],
      locale: r["locale"],
      title: r["title"],
      content: r["content"],
      folder: r["folder"],
      updatedAt: String(r["updatedAt"] ?? ""),
    })),
  };
};

// Deliberate no-op: `content` is annotated `userOwned`, so erasure runs via
// crypto-shredding — destroying the owner's subject key makes every event AND
// the projected row unreadable at once. A physical DELETE would not be
// rebuild-safe here: user-content-entry is event-sourced, so a replay would
// bring the row back (with unreadable content, but back).
// Precondition: this only erases anything if the app mounts a KMS adapter —
// without one, userOwned fields fall back to plaintext framework-wide and
// forget is a true no-op for `content`. Same property as notes-history.
export const userContentDeleteHook: UserDataDeleteHook = async () => {};
