import type { OwnershipMap } from "@cosmicdrift/kumiko-framework/engine";

// `where`-rules are read-path only (buildOwnershipClause). On the write path
// userCanWriteFieldRow silently skips them (fail-closed deny), but
// userCanCreateFieldRow does NOT skip them — it runs matchesRule(), which
// throws for `kind: "where"` (no in-memory evaluator for raw SQL). An
// ownership.write map with a where-rule boots fine (the boot-validator has no
// where-specific handling either) and only blows up the first time a create
// hits it. Feature factories that accept an `ownership` option must reject
// this shape at build time instead of shipping the landmine.
export function hasWhereRule(map: OwnershipMap | undefined): boolean {
  if (!map) return false;
  return Object.values(map).some((rule) => rule !== "all" && rule.kind === "where");
}
