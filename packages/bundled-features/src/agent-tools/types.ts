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

export type AgentToolMode = "read-only" | "approval" | "edit";

export type ToolCatalogOptions = {
  readonly mode: AgentToolMode;
  /** Caller's roles — the manifest is already role-filtered but does not carry
   *  roles back out, and get_/list_ are enumerated from the registry. */
  readonly roles: readonly string[];
  /** Locale to pick entity/field labels from the manifest's label maps. */
  readonly locale: string;
};

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
    }
  | {
      readonly kind: "server";
      readonly op: "query";
      readonly qn: string;
      readonly risk: AgentRisk;
      readonly entity?: string;
      /** Set for `list_<entity>`: dispatch builds the entityListSchema payload
       *  itself and validates field names against these allowlists. */
      readonly list?: {
        readonly searchableFields: readonly string[];
        readonly filterableFields: readonly string[];
      };
      /** Set for `get_<entity>`. */
      readonly detail?: true;
    }
  | {
      readonly kind: "server";
      readonly op: "write";
      readonly qn: string;
      readonly risk: AgentRisk;
      readonly entity?: string;
      /** `<feature>:query:<entity>:detail` QN when one is mounted and readable.
       *  Dispatch reads the current `version` from it before an optimistic-lock
       *  write, and re-reads through it after a successful write so the result
       *  goes through the field-level read filter. */
      readonly detailQn?: string;
      /** True when the handler schema requires `version` and `detailQn` exists,
       *  so the catalog stripped `version` from the model-facing input schema. */
      readonly injectsVersion?: boolean;
    }
  | {
      readonly kind: "client";
      readonly op: "navigate";
      /** entity name → detail screen id, resolved from the manifest's `detailFor`. */
      readonly entityScreens: ReadonlyMap<string, string>;
      /** Every screen id present in the role-filtered manifest — the allowlist
       *  for the `{ screenId, params }` form. */
      readonly screenIds: ReadonlySet<string>;
    }
  | {
      readonly kind: "client";
      readonly op: "open_form";
      /** write-handler QN → actionForm/entityEdit screen id. */
      readonly formScreens: ReadonlyMap<string, string>;
    }
  | { readonly kind: "client"; readonly op: "ask_user" };

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
  /** Entity this screen is the detail view for. Distinct from `entity`: a custom
   *  screen can render entity A while being the detail view for B. */
  readonly detailFor?: string;
  /** Write-handler QN an `actionForm` screen submits to. */
  readonly handler?: string;
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
