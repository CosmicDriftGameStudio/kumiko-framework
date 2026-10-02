// Public API

export { hasAccess } from "./access.js";
export {
  isPrincipalStatusPlugin,
  isTenantLifecycleStatusPlugin,
  type PrincipalProfile,
  type PrincipalStatus,
  type PrincipalStatusPlugin,
  TENANT_TEARDOWN_STATUSES,
  type TenantLifecycleStatusPlugin,
} from "./active-membership.js";
export {
  PII_DIRECT_NAME_HINTS,
  PII_USER_OWNED_NAME_HINTS,
  PII_USER_REFERENCE_NAME_HINTS,
} from "./boot-validator/entity-handler.js";
export { entityHasAnonymizableSubjectField } from "./boot-validator/pii-retention.js";
export {
  collectWriteHandlerQns,
  MAX_TRANSFER_DEPTH,
  SECURITY_BASELINE_FEATURE_NAMES,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "./boot-validator.js";
export { type BuildAppSchemaOptions, buildAppSchema } from "./build-app-schema.js";
export type { ConfigFeatureSchema } from "./build-config-feature-schema.js";
export {
  buildConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
  SETTINGS_HUB_WORKSPACE,
} from "./build-config-feature-schema.js";
export { buildTarget } from "./build-target.js";
export { type PendingChange, parseChangesetChanges } from "./changeset-changes.js";
export {
  access,
  createSeed,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createUserConfig,
  createUserSeed,
  isEncryptedAtRest,
} from "./config-helpers.js";
export type { SystemHookName } from "./constants.js";
export {
  ConcurrencyModes,
  ConfigScopes,
  LifecycleHookTypes,
  MessageKind,
  OnDeleteStrategies,
  SystemHookNames,
  SystemHookPriorities,
  TENANT_CURRENCY_CONFIG_KEY,
  tenantChannel,
} from "./constants.js";
export type { App, AppConfig } from "./create-app.js";
export { createApp } from "./create-app.js";
export { crossTenantOverrideDenied } from "./cross-tenant.js";
export { dedupeFeatures } from "./dedupe-features.js";
export { defineFeature } from "./define-feature.js";
export type {
  PagedQueryHandlerDefinition,
  QueryHandlerDefinition,
  StreamHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./define-handler.js";
export {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
  isPagedQueryHandler,
} from "./define-handler.js";
export { defineRoles } from "./define-roles.js";
export { defineStep, getStep, listStepKinds } from "./define-step.js";
export type { WorkflowDefinition, WorkflowInput, WorkflowTrigger } from "./define-workflow.js";
export { computeDefinitionFingerprint, defineWorkflow } from "./define-workflow.js";
export type { ToggleReader } from "./effective-features.js";
export { computeEffectiveFeatures, isToggleableFeature } from "./effective-features.js";
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
  type EntityCrudRegistrar,
  entityListSchema,
  MAX_LIST_LIMIT,
  type RegisterEntityCrudOptions,
  registerEntityCrud,
} from "./entity-handlers.js";
export { declareEscapeHatch } from "./escape-hatch-declaration.js";
export type { EmitCtx } from "./event-helpers.js";
export { emitEvent, typedPayload } from "./event-helpers.js";
export type { KumikoExtensionName, TenantResourceExtensionName } from "./extension-names.js";
export {
  EXT_ASSIGNABLE_ROLE,
  EXT_DERIVATIVE_OVERLAY_RESOLVER,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  EXT_DERIVATIVE_RENDERER,
  EXT_EXTERNAL_RESOURCE,
  EXT_FILE_PROVIDER,
  EXT_INFRA_RESOURCE,
  EXT_PRINCIPAL_STATUS,
  EXT_SEARCH_ADAPTER,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  EXT_TENANT_LIFECYCLE_STATUS,
  EXT_USER_DATA,
  EXT_USER_DATA_ORDER,
  FILE_PROVIDER_CONFIG_KEY,
  FILE_STORAGE_PROVIDER_BOOT_SENTINEL,
  FILE_STORAGE_PROVIDER_ENV,
  TENANT_MEMBERSHIPS_QUERY,
} from "./extension-names.js";
export {
  EXTENSION_SELECTOR_HINT_KEY,
  extensionSelectorTargets,
  SELECTED_EXTENSIONS_QUERY,
  selectablePluginIds,
} from "./extension-selector-plugins.js";
export { extensionUsageEscapeHatchReason } from "./extensions/escape-hatch-usage.js";
export type {
  StorageProviderDestroyTenantHook,
  StorageProviderExtensionHooks,
  StorageProviderHookCtx,
} from "./extensions/storage-provider.js";
export {
  isTenantDataExtensionHooks,
  type TenantDataDestroyHook,
  type TenantDataExtensionHooks,
  type TenantDataHookCtx,
} from "./extensions/tenant-data.js";
export {
  isTenantResourceExtensionHooks,
  type TenantResourceDestroyHook,
  type TenantResourceExtensionHooks,
  type TenantResourceHookCtx,
} from "./extensions/tenant-resource.js";
export type {
  TenantUserModel,
  UserDataDeleteHook,
  UserDataDeleteStrategy,
  UserDataExportHook,
  UserDataExportSnippet,
  UserDataExtensionHooks,
  UserDataExtensionOptions,
  UserDataHookCtx,
  UserDataStorageProvider,
} from "./extensions/user-data.js";
export {
  createBigIntField,
  createBooleanField,
  createDateField,
  createDecimalField,
  createDerivedField,
  createEmbeddedField,
  createEmbeddedListField,
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
} from "./factories.js";
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
  HandlerHeaderUpdate,
  ParseError,
  ParseResult,
  PatternCategory,
  PatternChange,
  PatternChangeIssue,
  PatternChangesParseResult,
  PatternFormSchema,
  PatternId,
  RenderFeatureFileInput,
  SourceLocation,
} from "./feature-ast/index.js";
export {
  addPattern,
  applyChanges,
  createFeaturePatcher,
  getPatternSchema,
  groupByCategory,
  PATTERN_LIBRARY,
  parseFeatureFile,
  parsePatternChanges,
  parseSourceFile,
  removePattern,
  renderFeatureFile,
  renderPattern,
  replacePattern,
  updatePattern,
  VERSION_HEADER,
} from "./feature-ast/index.js";
export {
  type ChangelogEntry,
  type ChangelogType,
  compareVersions,
  type FeatureChangelog,
  filterEntriesAfter,
  parseFeatureChangelog,
  sortEntries,
  validateChangelog,
} from "./feature-changelog.js";
export {
  type BuildManifestOptions,
  buildManifestFromRegistry,
  type FeatureManifest,
  type ManifestConfigKey,
  type ManifestExtension,
  type ManifestFeature,
  type ManifestSecret,
  serializeManifest,
} from "./feature-manifest.js";
export {
  checkWriteFieldOwnership,
  checkWriteFieldRoles,
  filterReadFields,
  maskWriteOnlyFields,
} from "./field-access.js";
export { resolveName, withResponseData } from "./handler-helpers.js";
export { i18nKey } from "./i18n-key.js";
// findForbiddenMembershipRole/isForbiddenMembershipRole/
// stripForbiddenMembershipRoles/buildSessionRoles are Public API for host
// apps that build their own membership handlers. FORBIDDEN_MEMBERSHIP_ROLES
// itself stays internal (637/3) — exporting the raw Set would make its
// representation a semver promise; the predicate functions are the intended
// surface.
export {
  buildSessionRoles,
  findForbiddenMembershipRole,
  isForbiddenMembershipRole,
  stripForbiddenMembershipRoles,
} from "./membership-roles.js";
export type { OwnershipClause, OwnershipMap, OwnershipRef, OwnershipRule } from "./ownership.js";
export {
  buildOwnershipClause,
  combineClauses,
  from,
  normalizeAccessEntry,
  userCanCreateFieldRow,
  userCanReadFieldRow,
  userCanWriteFieldRow,
} from "./ownership.js";
export type { ParsedRefTarget } from "./parse-ref-target.js";
export { parseRefTarget, parseRefTargetEntityName } from "./parse-ref-target.js";
export { buildPipelineSteps, stepsPipeline } from "./pipeline.js";
export { projectAppSchemaForRoles } from "./project-app-schema-for-roles.js";
export { defineApply, defineMspApply, setFields } from "./projection-helpers.js";
export type { BuiltinQnType, ParsedQn, QnType } from "./qualified-name.js";
export { isValidQn, parseQn, QnTypes, qn, toKebab } from "./qualified-name.js";
export { readClaim } from "./read-claim.js";
export { createRegistry } from "./registry.js";
export type { ClampInfo, ResolveOptions } from "./resolve-config-or-param.js";
export { resolveConfigOrParam } from "./resolve-config-or-param.js";
export type { AssignableAppRoles, AssignableFromRole } from "./role-assignment.js";
export {
  assignableAppRolesFromUsages,
  findForbiddenRoleAssignment,
  isAssignableByRole,
} from "./role-assignment.js";
export { runsInLane } from "./run-in.js";
export type { StepListOutcome } from "./run-pipeline.js";
export { runPipeline, runStepList } from "./run-pipeline.js";
export { buildInsertSchema, buildUpdateSchema, fieldToZod } from "./schema-builder.js";
export {
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  normalizeListColumn,
  sectionFieldSpecs,
} from "./screen-helpers.js";
export type { TransitionGraph } from "./state-machine.js";
export { defineTransitions, guardTransition } from "./state-machine.js";
export { evaluateEventMatch } from "./steps/_event-match.js";
export {
  STEP_DISPATCH_AGGREGATE_TYPE,
  STEP_DISPATCH_FAILED_TYPE,
  STEP_DISPATCH_REQUESTED_TYPE,
  STEP_DISPATCHED_TYPE,
  SUSPEND_SENTINEL,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RESUMED_TYPE,
  WORKFLOW_RETRY_SCHEDULED_TYPE,
  WORKFLOW_RUN_COMPLETED_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
  WORKFLOW_WAITING_FOR_EVENT_TYPE,
  WORKFLOW_WAITING_TYPE,
} from "./steps/_step-dispatch-constants.js";
export { describeWorkflowStepError } from "./steps/describe-workflow-step-error.js";
export {
  ANONYMOUS_ROLE,
  ANONYMOUS_USER_ID,
  createAnonymousUser,
  createSystemUser,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "./system-user.js";
export {
  type EffectiveFeaturesResolver,
  findTierResolverUsage,
  isTierResolverPlugin,
  TENANT_TIER_RESOLVER_EXT,
  type TierResolverPlugin,
  type TrialGate,
} from "./tier-resolver-extension.js";
export { isSystemTenant, isUuid, parseTenantId, SYSTEM_TENANT_ID } from "./types/identifiers.js";
// Types
export type {
  AccessRule,
  ActionFormScreenDefinition,
  ActiveMembership,
  ActiveMembershipRejection,
  ActiveMembershipResult,
  AgentExposure,
  AgentHandlerHints,
  AgentRisk,
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
  ContentCollectionDefinition,
  CreateSeedOptions,
  CreateTenantSeedOptions,
  CreateUserSeedOptions,
  CustomScreenDefinition,
  CustomScreenRoute,
  DashboardChartPanel,
  DashboardCustomPanel,
  DashboardFeedPanel,
  DashboardFilterDefinition,
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardPanelVisibility,
  DashboardProgressListPanel,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DateFieldDef,
  DecimalFieldDef,
  DeleteContext,
  DeriveContext,
  DerivedFieldDef,
  DerivedFieldsMap,
  DerivedValueType,
  EditExtensionSection,
  EditFieldSpec,
  EditFieldsSection,
  EditLayout,
  EditRelatedListSection,
  EditSectionSpec,
  EntityDefinition,
  EntityEditScreenDefinition,
  EntityId,
  EntityListExpandableRow,
  EntityListScreenDefinition,
  EntityRef,
  EntityRelations,
  EscapeHatchAuditSink,
  EscapeHatchDeclaration,
  EscapeHatchKind,
  EscapeHatchReporter,
  EscapeHatchTarget,
  EscapeHatchUseEvent,
  EventDef,
  ExtensionOptionsArgs,
  ExtensionOptionsFor,
  FeatureDefinition,
  FeatureRegistrar,
  FieldAccess,
  FieldCondition,
  FieldDefinition,
  FieldFormatRegistry,
  FieldIconKey,
  FieldRenderer,
  FileFieldDef,
  FilesFieldDef,
  Findability,
  FormatSpec,
  FormWidth,
  HandlerContext,
  HasManyRelation,
  HookMap,
  ImageFieldDef,
  ImagesFieldDef,
  JobBackoff,
  JobBackoffStrategy,
  JobContext,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  JobTriggerEvent,
  JsonbFieldDef,
  KumikoEntityTypeMap,
  KumikoEventTypeMap,
  KumikoExtensionOptionsMap,
  KumikoHandlerPayloadMap,
  KumikoHandlerResultMap,
  LifecycleHookType,
  ListColumnSpec,
  ListFacetSpec,
  ListPaginationMode,
  ListSortDir,
  ListSortSpec,
  LongTextFindability,
  ManyToManyRelation,
  MemberReader,
  MetricNavigate,
  MetricSpec,
  MspErrorMode,
  MspErrorPolicy,
  MultiSelectFieldDef,
  MultiStreamApplyFn,
  MultiStreamProjectionDefinition,
  NameOrRef,
  NavDefinition,
  NavIconKey,
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
  OpenToAllAccessRule,
  OpenToAllDeclaration,
  OpenToAllPersonalData,
  ParentRefDef,
  PersonalAnnotations,
  PersonalAnnotationsLongText,
  PersonalAnnotationsNoFind,
  PersonalSubject,
  PlatformComponent,
  PluralForms,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreQueryHookFn,
  PreSaveHookFn,
  ProjectionDefinition,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  ProjectionTable,
  QualifiedEventName,
  QueryEvent,
  QueryHandlerDef,
  QueryHandlerFn,
  RateLimitPer,
  RecordHeaderSpec,
  RecordHeaderSubtitlePart,
  ReferenceDataDef,
  Registry,
  RelationDefinition,
  ResolvedPiiFlags,
  RetentionDef,
  RoleAccessPersonalData,
  RoleAccessRule,
  RowAction,
  RowActionNavigate,
  RowActionNavigateBase,
  RowActionWriteHandler,
  RowFieldExtractor,
  SaveContext,
  ScreenDefinition,
  ScreenFilter,
  ScreenFilterOp,
  ScreenNavSugar,
  ScreenSlots,
  SecretKeyHandle,
  SecretMintConfirmStep,
  SecretMintScreenDefinition,
  SecretReveal,
  SecretRevealField,
  SecretsEditScreenDefinition,
  SecretsEditSection,
  SelectFieldDef,
  SessionUser,
  SessionUserOrigin,
  StreamHandlerDef,
  StreamHandlerFn,
  Subscribe,
  TargetRef,
  TenantId,
  TextFieldDef,
  ToolbarAction,
  TranslationEntry,
  TranslationKeys,
  TranslationsDef,
  TranslationValue,
  TreeAction,
  TreeActionDef,
  TreeActionsHandle,
  TreeChildrenSubscribe,
  TreeNode,
  TreeNodeState,
  UnitKey,
  UnsafeAppendEventFn,
  ValidationError,
  ValidationHookFn,
  WorkspaceDefinition,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerFn,
  WriteResult,
} from "./types/index.js";
export {
  DEFAULT_CURRENCIES,
  DEFAULT_LOCALES,
  HookPhases,
  isAgentVisibleScreen,
  isOpenToAllGranted,
  resolveAgentExposure,
} from "./types/index.js";
export type {
  AwaitedEventType,
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
} from "./types/step.js";
export { runValidation } from "./validation.js";
