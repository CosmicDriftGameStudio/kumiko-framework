// Barrel: re-exports all types from logical modules
// Duplicate types (OnDeleteStrategy, ConfigScope, ConcurrencyMode, LifecycleHookType)
// are defined ONLY in constants.ts — re-exported here for backwards compatibility.

// Re-export types that were duplicated in types.ts but are canonical in constants.ts
export type {
  ConcurrencyMode,
  ConfigScope,
  LifecycleHookType,
  OnDeleteStrategy,
} from "../constants";
export type {
  ConfigDefinition,
  ConfigKeyAccess,
  ConfigKeyDefinition,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
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
export type {
  BooleanFieldDef,
  DateFieldDef,
  DefaultCurrency,
  EmbeddedFieldDef,
  EmbeddedSubFieldDef,
  EntityDefinition,
  FieldAccess,
  FieldDefinition,
  FileFieldDef,
  FilesFieldDef,
  ImageFieldDef,
  ImagesFieldDef,
  MoneyFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
  TransitionMap,
} from "./fields";
export { DEFAULT_CURRENCIES } from "./fields";
export type {
  AccessRule,
  AppContext,
  CrudRefs,
  EntityRef,
  EventDef,
  HandlerContext,
  HandlerRef,
  JobContext,
  JobRunnerRef,
  NameOrRef,
  NotifyFactory,
  NotifyFn,
  QueryEvent,
  QueryHandlerDef,
  QueryHandlerFn,
  SessionUser,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerFn,
  WriteResult,
} from "./handlers";
export { resolveName } from "./handlers";
export type {
  DeleteContext,
  EntityHookMap,
  HookMap,
  LifecycleHookFn,
  LifecycleResult,
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
  BelongsToRelation,
  EntityRelations,
  HasManyRelation,
  ManyToManyRelation,
  RelationDefinition,
} from "./relations";
