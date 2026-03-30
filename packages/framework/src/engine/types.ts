import type { ZodType, z } from "zod";

// --- Field Types ---

export type TextFieldDef = {
  readonly type: "text";
  readonly maxLength?: number;
  readonly required?: boolean;
  readonly searchable?: boolean;
  readonly sortable?: boolean;
  readonly format?: "email" | "url" | "phone";
  readonly default?: string;
};

export type BooleanFieldDef = {
  readonly type: "boolean";
  readonly required?: boolean;
  readonly default?: boolean;
};

export type SelectFieldDef<TOptions extends readonly string[] = readonly string[]> = {
  readonly type: "select";
  readonly options: TOptions;
  readonly required?: boolean;
  readonly default?: TOptions[number];
};

export type NumberFieldDef = {
  readonly type: "number";
  readonly required?: boolean;
  readonly default?: number;
};

export type DateFieldDef = {
  readonly type: "date";
  readonly required?: boolean;
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
};

// --- Relations ---

export type BelongsToRelation = {
  readonly type: "belongsTo";
  readonly target: string;
  readonly foreignKey: string;
  readonly searchInclude?: readonly string[];
};

export type HasManyRelation = {
  readonly type: "hasMany";
  readonly target: string;
  readonly foreignKey: string;
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

export type HookMap = Readonly<Record<string, Readonly<Record<string, ValidationHookFn>>>>;

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
  getAllTranslations(): TranslationKeys;
};
