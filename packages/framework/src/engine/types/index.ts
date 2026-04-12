// Barrel: re-exports all types from logical modules
// Duplicate types (OnDeleteStrategy, ConfigScope, ConcurrencyMode, LifecycleHookType)
// are defined ONLY in constants.ts — re-exported here for backwards compatibility.

export type {
  BooleanFieldDef,
  DateFieldDef,
  EntityDefinition,
  FieldAccess,
  FieldDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
} from "./fields";

export type {
  BelongsToRelation,
  EntityRelations,
  HasManyRelation,
  ManyToManyRelation,
  RelationDefinition,
} from "./relations";

export type {
  AccessRule,
  CrudRefs,
  EventDef,
  HandlerContext,
  HandlerRef,
  JobContext,
  PipelineContext,
  QueryEvent,
  QueryHandlerDef,
  QueryHandlerFn,
  SessionUser,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerFn,
  WriteResult,
} from "./handlers";

export type {
  DeleteContext,
  EntityHookMap,
  HookMap,
  LifecycleHookFn,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  SaveContext,
  ValidationError,
  ValidationHookFn,
} from "./hooks";

export type {
  ConfigDefinition,
  ConfigKeyAccess,
  ConfigKeyDefinition,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionHooks,
  RegistrarExtensionRegistration,
  TranslationEntry,
  TranslationKeys,
  TranslationsDef,
  UiExtensionDef,
} from "./config";

export type { FeatureDefinition, FeatureRegistrar, Registry } from "./feature";

// Re-export types that were duplicated in types.ts but are canonical in constants.ts
export type { ConcurrencyMode, ConfigScope, LifecycleHookType, OnDeleteStrategy } from "../constants";
