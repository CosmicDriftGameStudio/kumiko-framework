import type { ZodType, z } from "zod";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type {
  ConfigDefinition,
  ConfigKeyDefinition,
  JobDefinition,
  JobHandlerFn,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  TranslationKeys,
  TranslationsDef,
} from "./config";
import type { EntityDefinition } from "./fields";
import type {
  AccessRule,
  CrudRefs,
  EventDef,
  HandlerRef,
  QueryHandlerDef,
  QueryHandlerFn,
  WriteHandlerDef,
  WriteHandlerFn,
} from "./handlers";
import type {
  EntityHookMap,
  HookMap,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ValidationHookFn,
} from "./hooks";
import type { EntityRelations, RelationDefinition } from "./relations";

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
  readonly configReads: readonly string[];
};

// --- Feature Registrar (the "r" object in defineFeature) ---

export type FeatureRegistrar = {
  requires(...featureNames: string[]): void;
  optionalRequires(...featureNames: string[]): void;

  entity(name: string, definition: EntityDefinition): void;

  writeHandler<TName extends string, TSchema extends ZodType>(
    def: WriteHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
  writeHandler<TSchema extends ZodType>(
    name: string,
    schema: TSchema,
    handler: WriteHandlerFn<z.infer<TSchema>>,
    options?: { access?: AccessRule },
  ): HandlerRef;

  queryHandler<TName extends string, TSchema extends ZodType>(
    def: QueryHandlerDefinition<TName, TSchema>,
  ): HandlerRef;
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

  entityHook(type: "postSave", entity: string, fn: PostSaveHookFn): void;
  entityHook(type: "preDelete", entity: string, fn: PreDeleteHookFn): void;
  entityHook(type: "postDelete", entity: string, fn: PostDeleteHookFn): void;

  config(definition: ConfigDefinition): void;

  job(name: string, options: Omit<JobDefinition, "name" | "handler">, handler: JobHandlerFn): void;

  translations(def: TranslationsDef): void;

  defineEvent<TPayload>(name: string, schema: ZodType<TPayload>): EventDef<TPayload>;

  readsConfig(...qualifiedKeys: string[]): void;

  referenceData(
    entityName: string,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

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
