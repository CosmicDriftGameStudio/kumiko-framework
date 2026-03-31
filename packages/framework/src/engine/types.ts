import type { ZodType, z } from "zod";

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

export type FieldDefinition =
  | TextFieldDef
  | BooleanFieldDef
  | SelectFieldDef
  | NumberFieldDef
  | DateFieldDef;

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

export type PipelineUser = {
  readonly id: number;
  readonly tenantId: number;
  readonly roles: readonly string[];
};

// --- Handler Events ---

export type WriteEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: PipelineUser;
};

export type QueryEvent<TPayload = unknown> = {
  readonly type: string;
  readonly payload: TPayload;
  readonly user: PipelineUser;
};

// --- Handler Results ---

export type WriteResult<TData = unknown> =
  | { readonly isSuccess: true; readonly data: TData }
  | { readonly isSuccess: false; readonly error: string };

// --- Pipeline Context (grows with each step) ---

export type PipelineContext = Record<string, unknown>;

// --- Handler Functions ---

export type WriteHandlerFn<TPayload = unknown, TData = unknown> = (
  event: WriteEvent<TPayload>,
  context: PipelineContext,
) => Promise<WriteResult<TData>>;

export type QueryHandlerFn<TPayload = unknown, TResult = unknown> = (
  query: QueryEvent<TPayload>,
  context: PipelineContext,
) => Promise<TResult>;

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
};

export type DeleteContext = {
  readonly id: number;
  readonly data: Readonly<Record<string, unknown>>;
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

export type HookMap = {
  readonly validation: Readonly<Record<string, ValidationHookFn>>;
  readonly preSave: Readonly<Record<string, readonly PreSaveHookFn[]>>;
  readonly postSave: Readonly<Record<string, readonly PostSaveHookFn[]>>;
  readonly preDelete: Readonly<Record<string, readonly PreDeleteHookFn[]>>;
  readonly postDelete: Readonly<Record<string, readonly PostDeleteHookFn[]>>;
  readonly preQuery: Readonly<Record<string, readonly PreQueryHookFn[]>>;
};

// --- Feature Definition (output of defineFeature) ---

export type FeatureDefinition = {
  readonly name: string;
  readonly entities: Readonly<Record<string, EntityDefinition>>;
  readonly relations: Readonly<Record<string, EntityRelations>>;
  readonly writeHandlers: Readonly<Record<string, WriteHandlerDef>>;
  readonly queryHandlers: Readonly<Record<string, QueryHandlerDef>>;
  readonly translations: TranslationKeys;
  readonly hooks: HookMap;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

export type FeatureRegistrar = {
  entity(name: string, definition: EntityDefinition): void;

  writeHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: WriteHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): void;

  queryHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: QueryHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): void;

  crud(entityName: string, options?: { access?: AccessRule }): void;

  relation(entityName: string, relationName: string, definition: RelationDefinition): void;

  hook(type: "validation", name: string, fn: ValidationHookFn): void;
  hook(type: "preSave", entityOrHandler: string, fn: PreSaveHookFn): void;
  hook(type: "postSave", entityOrHandler: string, fn: PostSaveHookFn): void;
  hook(type: "preDelete", entityOrHandler: string, fn: PreDeleteHookFn): void;
  hook(type: "postDelete", entityOrHandler: string, fn: PostDeleteHookFn): void;
  hook(type: "preQuery", entityOrHandler: string, fn: PreQueryHookFn): void;

  translations(def: TranslationsDef): void;
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
  getAllTranslations(): TranslationKeys;
};
