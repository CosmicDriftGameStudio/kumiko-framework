import type { EntityDefinition } from "@cosmicdrift/kumiko-framework/engine";

/** Mirrors `ToolDefinition` in `@cosmicdriftgamestudio/kumiko-ai-foundation` (providers/types.ts)
 *  field-for-field so a generated catalog needs no translation layer at the call site. Kept as
 *  a local, dependency-free type — agent-tools has no ai-foundation/enterprise dependency. */
export type ToolDefinition = {
  readonly name: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly description: string;
};

/** Narrow view of `Registry` — only the two getters the catalog builder needs, so tests can pass
 *  a plain object instead of constructing a full 64-getter Registry. */
export type RegistrySearchView = {
  getAllEntities(): ReadonlyMap<string, EntityDefinition>;
  getSearchableFields(entityName: string): readonly string[];
};
