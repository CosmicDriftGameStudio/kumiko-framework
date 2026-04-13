import type { ZodType, z } from "zod";
import type { QueryHandlerDefinition, WriteHandlerDefinition } from "../define-handler";
import type {
  ConfigDefinition,
  ConfigKeyDefinition,
  JobDefinition,
  JobHandlerFn,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
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
  EntityRef,
  EventDef,
  HandlerRef,
  NameOrRef,
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
  readonly systemScope: boolean;
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
  readonly notifications: Readonly<Record<string, NotificationDefinition>>;
  readonly events: Readonly<Record<string, EventDef>>;
  readonly configReads: readonly string[];
  // Explicit handler → entity mapping set by r.crud() and r.writeHandler()/r.queryHandler()
  readonly handlerEntityMappings: Readonly<Record<string, string>>;
};

// --- Feature Registrar (the "r" object in defineFeature) ---

type RefOrRefs = NameOrRef | readonly NameOrRef[];

export type FeatureRegistrar = {
  systemScope(): void;
  requires(...featureNames: string[]): void;
  optionalRequires(...featureNames: string[]): void;

  entity(name: string, definition: EntityDefinition): EntityRef;

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

  crud(entity: NameOrRef, options?: { access?: AccessRule }): CrudRefs;

  relation(entity: NameOrRef, relationName: string, definition: RelationDefinition): void;

  hook(type: "validation", target: RefOrRefs, fn: ValidationHookFn): void;
  hook(type: "preSave", target: RefOrRefs, fn: PreSaveHookFn): void;
  hook(type: "postSave", target: RefOrRefs, fn: PostSaveHookFn): void;
  hook(type: "preDelete", target: RefOrRefs, fn: PreDeleteHookFn): void;
  hook(type: "postDelete", target: RefOrRefs, fn: PostDeleteHookFn): void;
  hook(type: "preQuery", target: RefOrRefs, fn: PreQueryHookFn): void;

  entityHook(type: "postSave", entity: NameOrRef, fn: PostSaveHookFn): void;
  entityHook(type: "preDelete", entity: NameOrRef, fn: PreDeleteHookFn): void;
  entityHook(type: "postDelete", entity: NameOrRef, fn: PostDeleteHookFn): void;

  config(definition: ConfigDefinition): void;

  job(name: string, options: Omit<JobDefinition, "name" | "handler">, handler: JobHandlerFn): void;

  notification(
    name: string,
    definition: {
      readonly trigger: { readonly on: NameOrRef };
      readonly recipient: NotificationRecipientFn;
      readonly data: NotificationDataFn;
    },
  ): void;

  translations(def: TranslationsDef): void;

  defineEvent<TPayload>(name: string, schema: ZodType<TPayload>): EventDef<TPayload>;

  readsConfig(...qualifiedKeys: string[]): void;

  referenceData(
    entity: NameOrRef,
    data: readonly Record<string, unknown>[],
    options?: { upsertKey?: string },
  ): void;

  extendsRegistrar(name: string, def: RegistrarExtensionDef): void;

  useExtension(extensionName: string, entity: NameOrRef, options?: Record<string, unknown>): void;
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
  isHandlerSystemScoped(qualifiedHandler: string): boolean;
  getAllTranslations(): TranslationKeys;
  getConfigKey(qualifiedKey: string): ConfigKeyDefinition | undefined;
  getAllConfigKeys(): ReadonlyMap<string, ConfigKeyDefinition>;
  getJob(qualifiedName: string): JobDefinition | undefined;
  getAllJobs(): ReadonlyMap<string, JobDefinition>;
  getEvent(qualifiedName: string): EventDef | undefined;
  getExtension(name: string): RegistrarExtensionDef | undefined;
  getExtensionUsages(extensionName: string): readonly RegistrarExtensionRegistration[];
  getAllNotifications(): ReadonlyMap<string, NotificationDefinition>;
  getAllReferenceData(): readonly ReferenceDataDef[];
};
