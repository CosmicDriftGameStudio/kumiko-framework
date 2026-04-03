import type { ZodType, z } from "zod";
import type { DbConnection } from "../db/connection";
import type { SearchAdapter } from "../search/types";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";

// --- Field Types ---

export type FieldAccess = {
  readonly read?: readonly string[];
  readonly write?: readonly string[];
};

export type TextFieldDef = {
  readonly type: "text";
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly encrypted?: boolean;
  readonly format?: "email" | "url" | "phone";
  readonly default?: string;
  readonly access?: FieldAccess;
};

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly required?: boolean;
  readonly default?: boolean;
  readonly access?: FieldAccess;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly default?: TOptions[number];
  readonly access?: FieldAccess;
};

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly default?: number;
  readonly access?: FieldAccess;
};

export type DateFieldDef = {
  readonly type: "date";
  readonly required?: boolean;
  readonly access?: FieldAccess;
};

export type FileFieldDef = {
  readonly type: "file";
  readonly maxSize?: string; // e.g. "10mb"
  readonly accept?: readonly string[]; // e.g. ["pdf", "doc"]
  readonly access?: FieldAccess;
};

export type ImageFieldDef = {
  readonly type: "image";
  readonly maxSize?: string;
  readonly accept?: readonly string[]; // e.g. ["jpg", "png"]
  readonly thumbnails?: boolean;
  readonly access?: FieldAccess;
};

export type FilesFieldDef = {
  readonly type: "files";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  readonly access?: FieldAccess;
};

export type ImagesFieldDef = {
  readonly type: "images";
  readonly maxSize?: string;
  readonly accept?: readonly string[];
  readonly maxCount?: number;
  readonly thumbnails?: boolean;
  readonly access?: FieldAccess;
};

export type FieldDefinition =
  | TextFieldDef
  | BooleanFieldDef
  | SelectFieldDef
  | NumberFieldDef
  | DateFieldDef
  | FileFieldDef
  | ImageFieldDef
  | FilesFieldDef
  | ImagesFieldDef;

// --- Entity ---

export type EntityDefinition = {
  readonly table: string;
  readonly fields: Readonly<Record<string, FieldDefinition>>;
  readonly softDelete?: boolean;
  readonly searchWeight?: number;
};

// --- Relations ---

export type OnDeleteStrategy = "cascade" | "restrict" | "setNull" | "nothing";

export type BelongsToRelation = {
  readonly type: "belongsTo";
  readonly target: string;
  readonly foreignKey: string;
  readonly searchInclude?: readonly string[];
  readonly onDelete?: OnDeleteStrategy;
};

export type HasManyRelation = {
  readonly type: "hasMany";
  readonly target: string;
  readonly foreignKey: string;
  readonly onDelete?: OnDeleteStrategy;
};

export type ManyToManyRelation = {
  readonly type: "manyToMany";
  readonly target: string;
  readonly through: {
    readonly table: string;
    readonly sourceKey: string;
    readonly targetKey: string;
  };
  readonly searchInclude?: readonly string[];
  readonly onDelete?: OnDeleteStrategy;
};

export type RelationDefinition = BelongsToRelation | HasManyRelation | ManyToManyRelation;

export type EntityRelations = Readonly<Record<string, RelationDefinition>>;

// --- Access ---

export type AccessRule = {
  readonly roles: readonly string[];
};

// --- Pipeline User ---

export type SessionUser = {
  readonly id: number;
  readonly tenantId: number;
  readonly roles: readonly string[];
};

// --- Handler Events ---

export type WriteEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

export type QueryEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: SessionUser;
};

// --- Handler Results ---

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: string };

// --- Context Types ---

// Base: passed through the system, all optional
export type PipelineContext = {
  readonly db?: DbConnection;
  readonly registry?: Registry;
  readonly redis?: unknown;
  readonly jobRunner?: unknown;
  readonly configResolver?: unknown;
  readonly searchAdapter?: SearchAdapter;
  readonly systemUser?: SessionUser;
  readonly log?: (msg: string) => void;
  readonly warn?: (msg: string) => void;
  readonly logError?: (msg: string) => void;
  readonly triggeredBy?: { readonly id: number; readonly tenantId: number } | null;
  readonly _userId?: number | undefined;
  readonly _handlerType?: string | undefined;
};

// Handler execution: db + registry guaranteed
export type HandlerContext = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly searchAdapter?: SearchAdapter;
  readonly configResolver?: unknown;
  readonly jobRunner?: unknown;
  readonly systemUser?: SessionUser;
  readonly log?: (msg: string) => void;
  readonly warn?: (msg: string) => void;
  readonly logError?: (msg: string) => void;
  readonly triggeredBy?: { readonly id: number; readonly tenantId: number } | null;
  readonly _userId?: number | undefined;
  readonly _handlerType?: string | undefined;
};

// Job execution: db + registry + systemUser + logging guaranteed
export type JobContext = {
  readonly db: DbConnection;
  readonly registry: Registry;
  readonly systemUser: SessionUser;
  readonly log: (msg: string) => void;
  readonly warn: (msg: string) => void;
  readonly logError: (msg: string) => void;
  readonly triggeredBy: { readonly id: number; readonly tenantId: number } | null;
  readonly jobRunner?: unknown;
  readonly configResolver?: unknown;
};

// --- Handler Functions ---

export type WriteHandlerFn<TPayload = unknown, TData = unknown> = (
  event: WriteEvent<TPayload>,
  context: HandlerContext,
) => Promise<WriteResult<TData>>;

export type QueryHandlerFn<TPayload = unknown, TResult = unknown> = (
  query: QueryEvent<TPayload>,
  context: HandlerContext,
) => Promise<TResult>;

// --- Event Definitions ---

export type EventDef<TPayload = unknown> = {
  readonly name: string;
  readonly schema: ZodType<TPayload>;
};

// --- Handler References (returned by r.writeHandler / r.queryHandler) ---

export type HandlerRef = {
  readonly name: string;
};

export type CrudRefs = {
  readonly handlers: {
    readonly create: HandlerRef;
    readonly update: HandlerRef;
    readonly delete: HandlerRef;
  };
  readonly queries: {
    readonly list: HandlerRef;
    readonly detail: HandlerRef;
  };
};

// --- Handler Definitions (stored in feature/registry) ---

export type WriteHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: WriteHandlerFn;
  readonly access?: AccessRule;
};

export type QueryHandlerDef = {
  readonly name: string;
  readonly schema: ZodType;
  readonly handler: QueryHandlerFn;
  readonly access?: AccessRule;
};

// --- Translations ---

export type TranslationEntry = Readonly<Record<string, string>>;
export type TranslationKeys = Readonly<Record<string, TranslationEntry>>;

export type TranslationsDef = {
  readonly keys: TranslationKeys;
};

// --- Hooks ---

export type ValidationError = {
  readonly field: string;
  readonly error: string;
};

export type ValidationHookFn = (
  data: Readonly<Record<string, unknown>>,
) => readonly ValidationError[] | null;

// --- Save/Delete Context (what hooks receive) ---

export type SaveContext = {
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly previous: Readonly<Record<string, unknown>>;
  readonly isNew: boolean;
  readonly entityName?: string | undefined;
};

export type DeleteContext = {
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly entityName?: string | undefined;
};

// Lifecycle hooks — preSave can modify changes or abort (throw), postSave is fire-and-forget
export type PreSaveHookFn = (
  changes: Record<string, unknown>,
  context: PipelineContext & {
    readonly previous: Readonly<Record<string, unknown>>;
    readonly isNew: boolean;
  },
) => Promise<Record<string, unknown>>;

export type PostSaveHookFn = (result: SaveContext, context: PipelineContext) => Promise<void>;

export type PreDeleteHookFn = (payload: DeleteContext, context: PipelineContext) => Promise<void>;

export type PostDeleteHookFn = (payload: DeleteContext, context: PipelineContext) => Promise<void>;

export type PreQueryHookFn = (
  payload: Record<string, unknown>,
  context: PipelineContext,
) => Promise<Record<string, unknown>>;

export type LifecycleHookType = "preSave" | "postSave" | "preDelete" | "postDelete" | "preQuery";

export type LifecycleHookFn =
  | PreSaveHookFn
  | PostSaveHookFn
  | PreDeleteHookFn
  | PostDeleteHookFn
  | PreQueryHookFn;

// Handler hooks — keyed by handler name (qualified)
export type HookMap = {
  readonly validation: Readonly<Record<string, ValidationHookFn>>;
  readonly preSave: Readonly<Record<string, readonly PreSaveHookFn[]>>;
  readonly postSave: Readonly<Record<string, readonly PostSaveHookFn[]>>;
  readonly preDelete: Readonly<Record<string, readonly PreDeleteHookFn[]>>;
  readonly postDelete: Readonly<Record<string, readonly PostDeleteHookFn[]>>;
  readonly preQuery: Readonly<Record<string, readonly PreQueryHookFn[]>>;
};

// Entity hooks — keyed by entity name, fire for ALL writes on that entity
export type EntityHookMap = {
  readonly postSave: Readonly<Record<string, readonly PostSaveHookFn[]>>;
  readonly preDelete: Readonly<Record<string, readonly PreDeleteHookFn[]>>;
  readonly postDelete: Readonly<Record<string, readonly PostDeleteHookFn[]>>;
};

// --- Config ---

export type ConfigScope = "system" | "tenant" | "user";

export type ConfigKeyAccess = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type ConfigKeyDefinition = {
  readonly type: "text" | "number" | "boolean" | "select";
  readonly default?: string | number | boolean;
  readonly scope: ConfigScope;
  readonly access: ConfigKeyAccess;
  readonly encrypted?: boolean;
  readonly options?: readonly string[]; // for select type
};

export type ConfigDefinition = {
  readonly keys: Readonly<Record<string, ConfigKeyDefinition>>;
};

// --- Jobs ---

export type JobHandlerFn = (
  payload: Record<string, unknown>,
  context: PipelineContext,
) => Promise<void>;

export type ConcurrencyMode = "parallel" | "skip" | "replace" | "sequential" | "debounce";

export type JobTrigger =
  | { readonly on: string }
  | { readonly cron: string }
  | { readonly manual: true };

export type JobDefinition = {
  readonly name: string;
  readonly handler: JobHandlerFn;
  readonly trigger: JobTrigger;
  readonly concurrency?: ConcurrencyMode | undefined;
  readonly maxPerTenant?: number | undefined;
  readonly debounceMs?: number | undefined;
  readonly retries?: number | undefined;
  readonly backoff?: "fixed" | "exponential" | undefined;
  readonly timeout?: number | undefined;
  readonly schema?: ZodType | undefined;
  readonly runOnBoot?: boolean | undefined;
  readonly perTenant?: boolean | undefined;
};

// --- Registrar Extensions ---

export type RegistrarExtensionHooks = {
  readonly preSave?: PreSaveHookFn;
  readonly postSave?: PostSaveHookFn;
  readonly preDelete?: PreDeleteHookFn;
  readonly postDelete?: PostDeleteHookFn;
  readonly preQuery?: PreQueryHookFn;
};

export type UiExtensionDef = {
  readonly editSection?: string;
  readonly listColumns?: string;
  readonly filters?: string;
};

export type RegistrarExtensionDef = {
  readonly onRegister?: (entityName: string, options?: Record<string, unknown>) => void;
  readonly extendSchema?: (entityName: string) => Record<string, FieldDefinition>;
  readonly hooks?: RegistrarExtensionHooks;
  readonly extendSearch?: (entityName: string) => Record<string, unknown>;
  readonly uiExtension?: UiExtensionDef;
};

export type RegistrarExtensionRegistration = {
  readonly extensionName: string;
  readonly entityName: string;
  readonly options?: Record<string, unknown> | undefined;
};

// --- Reference Data ---

export type ReferenceDataDef = {
  readonly entityName: string;
  readonly data: readonly Record<string, unknown>[];
  readonly upsertKey?: string | undefined; // Field to match on for upsert (default: first field)
};

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
  readonly requires: readonly string[];
  readonly optionalRequires: readonly string[];
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks: HookMap;
  readonly entityHooks: EntityHookMap;
  readonly configKeys: Readonly<Record<string, ConfigKeyDefinition>>;
  readonly jobs: Readonly<Record<string, JobDefinition>>;
  readonly registrarExtensions: Readonly<Record<string, RegistrarExtensionDef>>;
  readonly extensionUsages: readonly RegistrarExtensionRegistration[];
  readonly referenceData: readonly ReferenceDataDef[];
  readonly events: Readonly<Record<string, EventDef>>;
  readonly configReads: readonly string[]; // Qualified config keys this feature reads
};

// --- Feature Registrar (the "r" object in defineFeature) ---

export type FeatureRegistrar = {
  requires(...featureNames: string[]): void;
  optionalRequires(...featureNames: string[]): void;

  entity(name: string, definition: EntityDefinition): void;

  // Object form (from defineWriteHandler):
  writeHandler<TName extends string, TSchema extends ZodType>(
    def: WriteHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  // Inline form (for small handlers):
  writeHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: WriteHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): HandlerRef;

  // Object form (from defineQueryHandler):
  queryHandler<TName extends string, TSchema extends ZodType>(
    def: QueryHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  // Inline form (for small handlers):
  queryHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: QueryHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): HandlerRef;

  crud(entityName: string, options?: { access?: AccessRule }): CrudRefs;

  relation(entityName: string, relationName: string, definition: RelationDefinition): void;

  hook(type: "validation", name: string | readonly string[], fn: ValidationHookFn): void;
  hook(type: "preSave", handler: string | readonly string[], fn: PreSaveHookFn): void;
  hook(type: "postSave", handler: string | readonly string[], fn: PostSaveHookFn): void;
  hook(type: "preDelete", handler: string | readonly string[], fn: PreDeleteHookFn): void;
  hook(type: "postDelete", handler: string | readonly string[], fn: PostDeleteHookFn): void;
  hook(type: "preQuery", handler: string | readonly string[], fn: PreQueryHookFn): void;

  // Entity hooks — fire for ALL writes on an entity (e.g. search indexing, SSE)
  entityHook(type: "postSave", entity: string, fn: PostSaveHookFn): void;
  entityHook(type: "preDelete", entity: string, fn: PreDeleteHookFn): void;
  entityHook(type: "postDelete", entity: string, fn: PostDeleteHookFn): void;

  config(definition: ConfigDefinition): void;

  job(name: string, options: Omit<JobDefinition, "name" | "handler">, handler: JobHandlerFn): void;

  translations(def: TranslationsDef): void;

  defineEvent<TPayload>(name: string, schema: ZodType<TPayload>): EventDef<TPayload>;

  // Declare config keys this feature reads from other features (for boot validation)
  readsConfig(...qualifiedKeys: string[]): void;

  referenceData(
    entityName: string,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

  // Use an extension registered by another feature.
  // e.g., r.useExtension("customFields", "order") instead of r.customFields("order")
  useExtension(extensionName: string, entityName: string, options?: Record<string, unknown>): void;
};

// --- Registry (created from features) ---

export type Registry = {
  readonly features: ReadonlyMap<string, FeatureDefinition>;

  getFeature(name: string): FeatureDefinition | undefined;
  getEntity(name: string): EntityDefinition | undefined;
  getWriteHandler(name: string): WriteHandlerDef | undefined;
  getQueryHandler(name: string): QueryHandlerDef | undefined;
  getSearchableFields(entityName: string): readonly string[];
  getSortableFields(entityName: string): readonly string[];
  getRelations(entityName: string): EntityRelations;
  getSearchIncludes(entityName: string): ReadonlyMap<string, readonly string[]>;
  getIncomingRelations(entityName: string): ReadonlyArray<{
    sourceEntity: string;
    relationName: string;
    relation: RelationDefinition;
  }>;
  getPreSaveHooks(name: string): readonly PreSaveHookFn[];
  getPostSaveHooks(name: string): readonly PostSaveHookFn[];
  getPreDeleteHooks(name: string): readonly PreDeleteHookFn[];
  getPostDeleteHooks(name: string): readonly PostDeleteHookFn[];
  getPreQueryHooks(name: string): readonly PreQueryHookFn[];
  // Entity hooks — fire for all writes on an entity
  getEntityPostSaveHooks(entityName: string): readonly PostSaveHookFn[];
  getEntityPreDeleteHooks(entityName: string): readonly PreDeleteHookFn[];
  getEntityPostDeleteHooks(entityName: string): readonly PostDeleteHookFn[];
  getHandlerEntity(qualifiedHandler: string): string | undefined;
  getAllTranslations(): TranslationKeys;
  getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined;
  getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition>;
  getJob(qualifiedName: string): JobDefinition | undefined;
  getAllJobs(): ReadonlyMap<string, JobDefinition>;
  getEvent(qualifiedName: string): EventDef | undefined;
  getExtension(name: string): RegistrarExtensionDef | undefined;
  getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[];
  getAllReferenceData(): readonly ReferenceDataDef[];
};
