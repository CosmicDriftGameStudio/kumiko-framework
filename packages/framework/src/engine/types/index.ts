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
  ConfigAccessor,
  ConfigAccessorFactory,
  ConfigDefinition,
  ConfigKeyAccess,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigResolver,
  ConfigStoredRow,
  ConfigValue,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
  NotificationTemplateFn,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionHooks,
  RegistrarExtensionRegistration,
  TranslationEntry,
  TranslationKeys,
  TranslationsDef,
  UiExtensionDef,
} from "./config";
export type {
  FeatureDefinition,
  FeatureMetricDef,
  FeatureMetricType,
  FeatureRegistrar,
  MetricOptions,
  Registry,
} from "./feature";
export type {
  AnyFileFieldDef,
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
  LocatedTimestampFieldDef,
  MoneyFieldDef,
  NumberFieldDef,
  SelectFieldDef,
  TextFieldDef,
  TimestampFieldDef,
  TransitionMap,
  TzFieldDef,
} from "./fields";
export { DEFAULT_CURRENCIES, isFileField } from "./fields";
export type {
  AccessRule,
  AggregateStreamHandle,
  AppContext,
  AppendEventArgs,
  EntityRef,
  EventDef,
  EventMigrationDef,
  EventUpcastCtx,
  EventUpcastFn,
  FetchForWritingArgs,
  HandlerContext,
  HandlerRef,
  JobContext,
  JobRunnerRef,
  NameOrRef,
  NotifyFactory,
  NotifyFn,
  NotifyOptions,
  NotifyPriority,
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
  HookPhase,
  LifecycleHookFn,
  LifecycleResult,
  PhasedHook,
  PostDeleteBatchHookFn,
  PostDeleteHookFn,
  PostSaveBatchHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  SaveContext,
  ValidationError,
  ValidationHookFn,
} from "./hooks";
export { HookPhases } from "./hooks";
// Domain-identifier type aliases — see identifiers.ts for rationale.
export type { EntityId, TenantId } from "./identifiers";
export { isSystemTenant, SYSTEM_TENANT_ID } from "./identifiers";
export type {
  MspErrorMode,
  MspErrorPolicy,
  MultiStreamApplyFn,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
  ProjectionTable,
  SingleStreamApplyFn,
} from "./projection";
export type {
  BelongsToRelation,
  EntityRelations,
  HasManyRelation,
  ManyToManyRelation,
  RelationDefinition,
} from "./relations";
