import type {
  AgentRisk,
  EntityDefinition,
  FeatureDefinition,
  NavDefinition,
  QueryHandlerDef,
  ScreenDefinition,
  TranslationKeys,
  WorkspaceDefinition,
  WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";

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

// --- agent manifest ---

export type AgentManifestOptions = {
  readonly locale: string;
  readonly roles: readonly string[];
  /** Tenant currency — the registry knows nothing about tenants, so the
   *  caller passes it through into the manifest's tenant-settings block. */
  readonly currency?: string;
};

export type AgentManifestField = {
  readonly name: string;
  readonly type: string;
  /** Label per app locale, keyed by locale code. */
  readonly labels: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly options?: readonly string[];
  /** Entity a `reference` field points at. */
  readonly references?: string;
  readonly searchable?: true;
  readonly filterable?: true;
  /** Marks the field as personal data. Never carries a value — the manifest
   *  is schema, not rows. */
  readonly pii?: true;
};

export type AgentManifestEntity = {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly fields: readonly AgentManifestField[];
};

export type AgentManifestHandler = {
  readonly qn: string;
  readonly kind: "query" | "write";
  readonly description: string;
  readonly risk: AgentRisk;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly entity?: string;
};

export type AgentManifestScreen = {
  readonly id: string;
  readonly type: string;
  readonly titles: Readonly<Record<string, string>>;
  readonly description?: string;
  readonly entity?: string;
  readonly params: readonly string[];
  readonly workspaces: readonly string[];
};

export type AgentManifestNav = {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly screen?: string;
  readonly parent?: string;
  readonly workspaces: readonly string[];
};

export type AgentManifestWorkspace = {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly default?: true;
};

export type AgentManifestFeature = {
  readonly name: string;
  readonly description?: string;
  readonly displayLabel?: string;
};

export type AgentManifest = {
  readonly features: readonly AgentManifestFeature[];
  readonly entities: readonly AgentManifestEntity[];
  readonly handlers: readonly AgentManifestHandler[];
  readonly screens: readonly AgentManifestScreen[];
  readonly navs: readonly AgentManifestNav[];
  readonly workspaces: readonly AgentManifestWorkspace[];
  readonly tenantSettings: {
    readonly locale: string;
    readonly currency?: string;
  };
};

/** Narrow view of `Registry` for manifest generation — same rationale as
 *  `RegistrySearchView`: tests build a plain object instead of a full
 *  Registry; a real `createRegistry(...)` result is structurally assignable. */
export type RegistryManifestView = {
  readonly features: ReadonlyMap<string, FeatureDefinition>;
  getAllEntities(): ReadonlyMap<string, EntityDefinition>;
  getAllQueryHandlers(): ReadonlyMap<string, QueryHandlerDef>;
  getAllWriteHandlers(): ReadonlyMap<string, WriteHandlerDef>;
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  getSearchableFields(entityName: string): readonly string[];
  getAllTranslations(): TranslationKeys;
  getAllScreens(): ReadonlyMap<string, ScreenDefinition>;
  getAllNavs(): ReadonlyMap<string, NavDefinition>;
  getAllWorkspaces(): ReadonlyMap<string, WorkspaceDefinition>;
};
