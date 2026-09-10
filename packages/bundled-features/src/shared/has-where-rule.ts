import type { OwnershipMap } from "@cosmicdrift/kumiko-framework/engine";

// `where`-rules are read-path only (buildOwnershipClause). The write path
// decides in memory against the concrete row, so a where-rule there can only
// ever deny — boot validation rejects the shape (fw#2626). Feature factories
// that accept an `ownership` option reject it earlier, at build time, so the
// author gets the option name in the message instead of an entity scope.
export function hasWhereRule(map: OwnershipMap | undefined): boolean {
  if (!map) return false;
  return Object.values(map).some((rule) => rule !== "all" && rule.kind === "where");
}
