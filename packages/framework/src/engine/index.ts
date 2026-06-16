// Public API

export { hasAccess } from "./access";
export {
  collectWriteHandlerQns,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "./boot-validator";
export { buildAppSchema } from "./build-app-schema";
export type { ConfigFeatureSchema } from "./build-config-feature-schema";
export {
  buildConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
  SETTINGS_HUB_WORKSPACE,
} from "./build-config-feature-schema";
export { buildTarget } from "./build-target";
export {
  access,
  createSeed,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createUserConfig,
  createUserSeed,
} from "./config-helpers";
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
export type {
  QueryHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./define-handler";
export { defineQueryHandler, defineWriteHandler } from "./define-handler";
export { defineRoles } from "./define-roles";
export { defineStep, getStep, listStepKinds } from "./define-step";
export type { WorkflowDefinition, WorkflowInput, WorkflowTrigger } from "./define-workflow";
export { computeDefinitionFingerprint, defineWorkflow } from "./define-workflow";
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
export type { KumikoExtensionName } from "./extension-names";
export {
  EXT_EXTERNAL_RESOURCE,
  EXT_INFRA_RESOURCE,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  EXT_USER_DATA,
  EXT_USER_DATA_ORDER,
} from "./extension-names";
export type {
  UserDataDeleteHook,
  UserDataDeleteStrategy,
  UserDataExportHook,
  UserDataExportSnippet,
  UserDataExtensionHooks,
  UserDataHookCtx,
} from "./extensions/user-data";
export {
  createBigIntField,
  createBooleanField,
  createDateField,
  createDecimalField,
  createEmbeddedField,
  createEntity,
  createFileField,
  createFilesField,
  createImageField,
  createImagesField,
  createJsonbField,
  createLocatedTimestampField,
  createLongTextField,
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
  type BuildManifestOptions,
  buildManifestFromRegistry,
  type FeatureManifest,
  type ManifestConfigKey,
  type ManifestExtension,
  type ManifestFeature,
  type ManifestSecret,
  serializeManifest,
} from "./feature-manifest";
export {
  checkWriteFieldOwnership,
  checkWriteFieldRoles,
  filterReadFields,
} from "./field-access";
export type { OwnershipClause, OwnershipMap, OwnershipRef, OwnershipRule } from "./ownership";
export { from } from "./ownership";
export { buildPipelineSteps, pipeline } from "./pipeline";
export { defineApply, defineMspApply, setFields } from "./projection-helpers";
export type { BuiltinQnType, ParsedQn, QnType } from "./qualified-name";
export { isValidQn, parseQn, QnTypes, qn, toKebab } from "./qualified-name";
export { readClaim } from "./read-claim";
export { createRegistry } from "./registry";
export type { ClampInfo, ResolveOptions } from "./resolve-config-or-param";
export { resolveConfigOrParam } from "./resolve-config-or-param";
export { runsInLane } from "./run-in";
export type { StepListOutcome } from "./run-pipeline";
export { runPipeline, runStepList } from "./run-pipeline";
export { buildInsertSchema, buildUpdateSchema, fieldToZod } from "./schema-builder";
export type { TransitionGraph } from "./state-machine";
export { defineTransitions, guardTransition } from "./state-machine";
export {
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "./steps/_step-dispatch-constants";
export {
  ANONYMOUS_ROLE,
  ANONYMOUS_USER_ID,
  createAnonymousUser,
  createSystemUser,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "./system-user";
export {
  type EffectiveFeaturesResolver,
  findTierResolverUsage,
  TENANT_TIER_RESOLVER_EXT,
  type TierResolverPlugin,
} from "./tier-resolver-extension";
// Types
export type {
  AccessRule,
  ActionFormScreenDefinition,
  AppContext,
  AppendEventArgs,
  AppendEventFn,
  AuthClaimsContext,
  AuthClaimsFn,
  AuthClaimsHookDef,
  BelongsToRelation,
  BigIntFieldDef,
  BooleanFieldDef,
  CamelToKebab,
  ClaimKeyDefinition,
  ClaimKeyHandle,
  ClaimKeyJsType,
  ClaimKeyType,
  ConcurrencyMode,
  ConfigAccessor,
  ConfigAccessorFactory,
  ConfigBacking,
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigDefinition,
  ConfigEditScreenDefinition,
  ConfigKeyAccess,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigMask,
  ConfigResolver,
  ConfigScope,
  ConfigSecretsReader,
  ConfigSeedDef,
  ConfigStoredRow,
  ConfigStoredRowWithSource,
  ConfigValue,
  ConfigValueSource,
  ConfigValueWithSource,
  CreateSeedOptions,
  CreateTenantSeedOptions,
  CreateUserSeedOptions,
  CustomScreenDefinition,
  CustomScreenRoute,
  DateFieldDef,
  DecimalFieldDef,
  DeleteContext,
  EditExtensionSection,
  EditFieldSpec,
  EditFieldsSection,
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
  JsonbFieldDef,
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
  PiiAnnotations,
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
  ReferenceDataDef,
  Registry,
  RelationDefinition,
  RetentionDef,
  RowAction,
  SaveContext,
  ScreenDefinition,
  ScreenSlots,
  SecretKeyHandle,
  SelectFieldDef,
  SessionUser,
  Subscribe,
  TargetRef,
  TenantId,
  TextFieldDef,
  ToolbarAction,
  TranslationKeys,
  TranslationsDef,
  TreeAction,
  TreeActionDef,
  TreeActionsHandle,
  TreeChildrenSubscribe,
  TreeNode,
  TreeNodeState,
  UnsafeAppendEventFn,
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
export { isExtensionEditSection, normalizeEditField, normalizeListColumn } from "./types/screen";
export type {
  PipelineBuildCtx,
  PipelineCtx,
  PipelineDef,
  StepBuilder,
  StepDef,
  StepFailureStrategy,
  StepInstance,
  StepKind,
  StepNamespace,
  StepResolver,
} from "./types/step";
export { runValidation } from "./validation";
