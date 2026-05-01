// Public API

export { hasAccess } from "./access";
export { validateBoot } from "./boot-validator";
export { buildAppSchema } from "./build-app-schema";
export { access, createSystemConfig, createTenantConfig, createUserConfig } from "./config-helpers";
export type { SystemHookName } from "./constants";
export {
  ConcurrencyModes,
  ConfigScopes,
  LifecycleHookTypes,
  MessageKind,
  OnDeleteStrategies,
  SystemHookNames,
  SystemHookPriorities,
  tenantChannel,
} from "./constants";
export type { App, AppConfig } from "./create-app";
export { createApp } from "./create-app";
export { defineFeature } from "./define-feature";
export type { QueryHandlerDefinition, WriteHandlerDefinition } from "./define-handler";
export { defineQueryHandler, defineWriteHandler } from "./define-handler";
export { defineRoles } from "./define-roles";
export type { ToggleReader } from "./effective-features";
export { computeEffectiveFeatures } from "./effective-features";
export {
  createEntityExecutor,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  // Legacy single-fn-with-verb-string API. Backwards-compat — neue
  // Apps nehmen die verb-spezifischen Wrapper oben. Existierende
  // Caller (Integration-Tests, alte bundled-features) bleiben so
  // unverändert lauffähig.
  defineEntityQueryHandler,
  defineEntityRestoreHandler,
  defineEntityUpdateHandler,
  defineEntityWriteHandler,
  defineProjectionQueryHandler,
} from "./entity-handlers";
export type { EmitCtx } from "./event-helpers";
export { emitEvent, typedPayload } from "./event-helpers";
export {
  createBooleanField,
  createDateField,
  createEmbeddedField,
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createLocatedTimestampField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
  locatedTimestamp,
} from "./factories";
// AST inspection + patching pipeline — used by the CLI scaffolder, the
// Designer (C5/C6), and the AI-Builder (L2). See feature-ast/index.ts
// for the full surface area; we re-export the most-used types/functions
// here so consumers can import everything from a single barrel.
export type {
  AddEntityArgs,
  AddHookArgs,
  AddRelationArgs,
  AddWriteHandlerArgs,
  FeaturePatcher,
  FeaturePattern,
  FeaturePatternKind,
  FormFieldLabel,
  FormFieldSpec,
  FormInputType,
  ParseError,
  ParseResult,
  PatternCategory,
  PatternChange,
  PatternFormSchema,
  PatternId,
  RenderFeatureFileInput,
  SourceLocation,
} from "./feature-ast";
export {
  addPattern,
  applyChanges,
  createFeaturePatcher,
  getPatternSchema,
  groupByCategory,
  PATTERN_LIBRARY,
  parseFeatureFile,
  parseSourceFile,
  removePattern,
  renderFeatureFile,
  renderPattern,
  replacePattern,
  VERSION_HEADER,
} from "./feature-ast";
export {
  checkWriteFieldOwnership,
  checkWriteFieldRoles,
  filterReadFields,
} from "./field-access";
export type { OwnershipClause, OwnershipMap, OwnershipRef, OwnershipRule } from "./ownership";
export { from } from "./ownership";
export { defineApply, defineMspApply, setFields } from "./projection-helpers";
export type { BuiltinQnType, ParsedQn, QnType } from "./qualified-name";
export { isValidQn, parseQn, QnTypes, qn, toKebab } from "./qualified-name";
export { readClaim } from "./read-claim";
export { createRegistry } from "./registry";
export type { ClampInfo, ResolveOptions } from "./resolve-config-or-param";
export { resolveConfigOrParam } from "./resolve-config-or-param";
export { runsInLane } from "./run-in";
export { buildInsertSchema, buildUpdateSchema } from "./schema-builder";
export type { TransitionGraph } from "./state-machine";
export { defineTransitions, guardTransition } from "./state-machine";
export {
  ANONYMOUS_ROLE,
  ANONYMOUS_USER_ID,
  createAnonymousUser,
  createSystemUser,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "./system-user";
// Types
export type {
  AccessRule,
  ActionFormScreenDefinition,
  AppContext,
  AppendEventArgs,
  AppendEventFn,
  AppendEventUnsafeFn,
  AuthClaimsContext,
  AuthClaimsFn,
  AuthClaimsHookDef,
  BelongsToRelation,
  BooleanFieldDef,
  CamelToKebab,
  ClaimKeyDefinition,
  ClaimKeyHandle,
  ClaimKeyJsType,
  ClaimKeyType,
  ConcurrencyMode,
  ConfigAccessor,
  ConfigAccessorFactory,
  ConfigDefinition,
  ConfigKeyAccess,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigResolver,
  ConfigScope,
  ConfigStoredRow,
  ConfigValue,
  ConfigValueSource,
  ConfigValueWithSource,
  CustomScreenDefinition,
  CustomScreenRoute,
  DateFieldDef,
  DeleteContext,
  EditFieldSpec,
  EditLayout,
  EditSectionSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityId,
  EntityListScreenDefinition,
  EntityRef,
  EntityRelations,
  EventDef,
  FeatureDefinition,
  FeatureRegistrar,
  FieldAccess,
  FieldCondition,
  FieldDefinition,
  FieldRenderer,
  FileFieldDef,
  FilesFieldDef,
  HandlerContext,
  HasManyRelation,
  HookMap,
  ImageFieldDef,
  ImagesFieldDef,
  JobContext,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  KumikoEntityTypeMap,
  KumikoEventTypeMap,
  KumikoHandlerPayloadMap,
  KumikoHandlerResultMap,
  LifecycleHookType,
  ListColumnSpec,
  ManyToManyRelation,
  MspErrorMode,
  MspErrorPolicy,
  MultiSelectFieldDef,
  MultiStreamApplyFn,
  MultiStreamProjectionDefinition,
  NameOrRef,
  NavDefinition,
  NotificationDataFn,
  NotificationDefinition,
  NotificationRecipientFn,
  NotificationTemplateFn,
  NotifyFactory,
  NotifyFn,
  NotifyOptions,
  NotifyPriority,
  NumberFieldDef,
  OnDeleteStrategy,
  PlatformComponent,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ProjectionDefinition,
  ProjectionTable,
  QualifiedEventName,
  QueryEvent,
  QueryHandlerDef,
  QueryHandlerFn,
  Registry,
  RelationDefinition,
  RowAction,
  SaveContext,
  ScreenDefinition,
  ScreenSlots,
  SelectFieldDef,
  SessionUser,
  TenantId,
  TextFieldDef,
  ToolbarAction,
  TranslationKeys,
  TranslationsDef,
  ValidationError,
  ValidationHookFn,
  WorkspaceDefinition,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerFn,
  WriteResult,
} from "./types";
export { DEFAULT_CURRENCIES, HookPhases } from "./types";
export { resolveName, withResponseData } from "./types/handlers";
export { isSystemTenant, parseTenantId, SYSTEM_TENANT_ID } from "./types/identifiers";
export { normalizeEditField, normalizeListColumn } from "./types/screen";
export { runValidation } from "./validation";
