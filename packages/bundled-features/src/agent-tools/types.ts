import type { EntityDefinition, QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";

/** Mirrors `ToolDefinition` in `@cosmicdriftgamestudio/kumiko-ai-foundation` (providers/types.ts)
 *  field-for-field so a generated catalog needs no translation layer at the call site. Kept as
 *  a local, dependency-free type — agent-tools has no ai-foundation/enterprise dependency. */
export type ToolDefinition = {
  readonly name: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly description: string;
};

/** Narrow, handler-first view of `Registry` — iterate query handlers (real, mounted, callable
 *  QNs) rather than entities, so the catalog never advertises a tool for an entity that has no
 *  `:list` handler mounted. Small enough that tests pass a plain object instead of a full
 *  64-getter Registry. */
export type RegistrySearchView = {
  getAllQueryHandlers(): ReadonlyMap<string, QueryHandlerDef>;
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  getEntity(entityName: string): EntityDefinition | undefined;
  getSearchableFields(entityName: string): readonly string[];
};

/** How to actually execute a generated tool — kept out of `ToolDefinition` (which mirrors the
 *  LLM-facing shape exactly) so dispatch never has to re-parse the tool name back into an entity
 *  + field. `buildToolCatalog` produces one of these per tool, keyed by tool name. */
export type ToolDispatchDescriptor =
  | { readonly kind: "search"; readonly entityName: string; readonly qn: string }
  | {
      readonly kind: "findBy";
      readonly entityName: string;
      readonly fieldName: string;
      readonly qn: string;
    };

export type ToolCatalog = {
  readonly tools: readonly ToolDefinition[];
  readonly dispatchTable: ReadonlyMap<string, ToolDispatchDescriptor>;
};
