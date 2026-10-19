// Public API

export { handlerFieldLabelKey, handlerTitleKey } from "../i18n/required-surface-keys.ts";
export { hasAccess } from "./access.ts";
export {
  isPrincipalStatusPlugin,
  isTenantLifecycleStatusPlugin,
  type PrincipalProfile,
  type PrincipalStatus,
  type PrincipalStatusPlugin,
  TENANT_TEARDOWN_STATUSES,
  type TenantLifecycleStatusPlugin,
} from "./active-membership.ts";
export {
  PII_DIRECT_NAME_HINTS,
  PII_USER_OWNED_NAME_HINTS,
  PII_USER_REFERENCE_NAME_HINTS,
} from "./boot-validator/entity-handler.ts";
export { entityHasAnonymizableSubjectField } from "./boot-validator/pii-retention.ts";
export {
  type CardMetaOverflow,
  collectCardMetaOverflow,
  collectWriteHandlerQns,
  MAX_TRANSFER_DEPTH,
  SECURITY_BASELINE_FEATURE_NAMES,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "./boot-validator.ts";
export { bridgeStub } from "./bridge-stub.ts";
export { type BuildAppSchemaOptions, buildAppSchema } from "./build-app-schema.ts";
export type { ConfigFeatureSchema } from "./build-config-feature-schema.ts";
export {
  buildConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
  SETTINGS_HUB_WORKSPACE,
} from "./build-config-feature-schema.ts";
export { buildTarget } from "./build-target.ts";
export { type PendingChange, parseChangesetChanges } from "./changeset-changes.ts";
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
} from "./config-helpers.ts";
export type { SystemHookName } from "./constants.ts";
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
} from "./constants.ts";
export type { App, AppConfig } from "./create-app.ts";
export { createApp } from "./create-app.ts";
export { mayOverrideTenant, tenantOverrideDenied } from "./cross-tenant.ts";
export { dedupeFeatures } from "./dedupe-features.ts";
export { defineFeature } from "./define-feature.ts";
export type {
  PagedQueryHandlerDefinition,
  QueryHandlerDefinition,
  StreamHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./define-handler.ts";
export {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
  isPagedQueryHandler,
} from "./define-handler.ts";
export { defineRoles } from "./define-roles.ts";
export { defineStep, getStep, listStepKinds } from "./define-step.ts";
export type { WorkflowDefinition, WorkflowInput, WorkflowTrigger } from "./define-workflow.ts";
export { computeDefinitionFingerprint, defineWorkflow } from "./define-workflow.ts";
export type { ToggleReader } from "./effective-features.ts";
export { computeEffectiveFeatures, isToggleableFeature } from "./effective-features.ts";
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
} from "./entity-handlers.ts";
export { declareEscapeHatch } from "./escape-hatch-declaration.ts";
export { type CreateEventDefOptions, createEventDef } from "./event-def.ts";
export type { EmitCtx } from "./event-helpers.ts";
export { emitEvent, typedPayload } from "./event-helpers.ts";
export type { KumikoExtensionName, TenantResourceExtensionName } from "./extension-names.ts";
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
} from "./extension-names.ts";
export {
  EXTENSION_SELECTOR_HINT_KEY,
  extensionSelectorTargets,
  SELECTED_EXTENSIONS_QUERY,
  selectablePluginIds,
} from "./extension-selector-plugins.ts";
export { extensionUsageEscapeHatchReason } from "./extensions/escape-hatch-usage.ts";
export type {
  StorageProviderDestroyTenantHook,
  StorageProviderExtensionHooks,
  StorageProviderHookCtx,
} from "./extensions/storage-provider.ts";
export {
  isTenantDataExtensionHooks,
  type TenantDataDestroyHook,
  type TenantDataExtensionHooks,
  type TenantDataHookCtx,
} from "./extensions/tenant-data.ts";
export {
  isTenantResourceExtensionHooks,
  type TenantDestroyHookResult,
  type TenantResourceDestroyHook,
  type TenantResourceExtensionHooks,
  type TenantResourceHookCtx,
} from "./extensions/tenant-resource.ts";
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
} from "./extensions/user-data.ts";
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
} from "./factories.ts";
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
} from "./feature-ast/index.ts";
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
} from "./feature-ast/index.ts";
export {
  type ChangelogEntry,
  type ChangelogType,
  compareVersions,
  type FeatureChangelog,
  filterEntriesAfter,
  parseFeatureChangelog,
  sortEntries,
  validateChangelog,
} from "./feature-changelog.ts";
export {
  type BuildManifestOptions,
  buildManifestFromRegistry,
  type FeatureManifest,
  type ManifestConfigKey,
  type ManifestExtension,
  type ManifestFeature,
  type ManifestSecret,
  type ManifestSystemEvent,
  serializeManifest,
} from "./feature-manifest.ts";
export {
  checkWriteFieldOwnership,
  checkWriteFieldRoles,
  filterReadFields,
  maskWriteOnlyFields,
} from "./field-access.ts";
export {
  HANDLER_FIELD_REFERENCES_META_KEY,
  type HandlerFieldPathSegment,
  type HandlerFieldReference,
  type HandlerFieldReferenceAtPath,
  type HandlerFieldReferenceMeta,
  handlerFieldReference,
  handlerFieldReferences,
  readHandlerFieldReferences,
} from "./handler-field-references.ts";
export { resolveName, withResponseData } from "./handler-helpers.ts";
export { i18nKey } from "./i18n-key.ts";
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
} from "./membership-roles.ts";
export type { OwnershipClause, OwnershipMap, OwnershipRef, OwnershipRule } from "./ownership.ts";
export {
  buildOwnershipClause,
  combineClauses,
  from,
  normalizeAccessEntry,
  userCanCreateFieldRow,
  userCanReadFieldRow,
  userCanWriteFieldRow,
} from "./ownership.ts";
export {
  type PagedListRequest,
  type PagedListRowValue,
  pagedListSchema,
  pageRows,
} from "./paged-list.ts";
export type { ParsedRefTarget } from "./parse-ref-target.ts";
export { parseRefTarget, parseRefTargetEntityName } from "./parse-ref-target.ts";
export { buildPipelineSteps, stepsPipeline } from "./pipeline.ts";
export { projectAppSchemaForRoles } from "./project-app-schema-for-roles.ts";
export { defineApply, defineMspApply, setFields } from "./projection-helpers.ts";
export type { BuiltinQnType, ParsedQn, QnType } from "./qualified-name.ts";
export { isValidQn, parseQn, QnTypes, qn, toKebab } from "./qualified-name.ts";
export { readClaim } from "./read-claim.ts";
export { createRegistry } from "./registry.ts";
export { qualifyTranslationKey } from "./registry-ingest.ts";
export type { ClampInfo, ResolveOptions } from "./resolve-config-or-param.ts";
export { resolveConfigOrParam } from "./resolve-config-or-param.ts";
export type { AssignableAppRoles, AssignableFromRole } from "./role-assignment.ts";
export {
  assignableAppRolesFromUsages,
  assignableAppRolesOf,
  BUILT_IN_MEMBERSHIP_ROLES,
  canActorAssignRole,
  findForbiddenRoleAssignment,
  isAssignableByRole,
  mergeAssignedRoles,
} from "./role-assignment.ts";
export { runsInLane } from "./run-in.ts";
export type { StepListOutcome } from "./run-pipeline.ts";
export { runPipeline, runStepList } from "./run-pipeline.ts";
export {
  buildInsertSchema,
  buildUpdateSchema,
  fieldToZod,
  SYSTEM_ONLY_JSON_SCHEMA_KEY,
} from "./schema-builder.ts";
export type { UnavailableSelectOption } from "./screen-helpers.ts";
export {
  availableSelectOptions,
  findUnavailableSelectOptions,
  isExtensionEditSection,
  isFieldsEditSection,
  isWriteFormEditSection,
  normalizeEditField,
  normalizeListColumn,
  sectionFieldSpecs,
} from "./screen-helpers.ts";
export type { TransitionGraph } from "./state-machine.ts";
export { defineTransitions, guardTransition } from "./state-machine.ts";
export { evaluateEventMatch } from "./steps/_event-match.ts";
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
} from "./steps/_step-dispatch-constants.ts";
export { describeWorkflowStepError } from "./steps/describe-workflow-step-error.ts";
export { unwrapWorkflowStepError, WorkflowStepError } from "./steps/workflow-step-error.ts";
export { WORKFLOW_SYSTEM_EVENT_DEFS } from "./steps/workflow-system-events.ts";
export {
  ANONYMOUS_ROLE,
  ANONYMOUS_USER_ID,
  createAnonymousUser,
  createSystemUser,
  SYSTEM_ROLE,
  SYSTEM_USER_ID,
} from "./system-user.ts";
export {
  assertNotificationVariables,
  templateVariable,
  templateVariablesToZod,
} from "./template-variables.ts";
export {
  type EffectiveFeaturesResolver,
  findTierResolverUsage,
  isTierResolverPlugin,
  requireTierResolverPlugin,
  TENANT_TIER_RESOLVER_EXT,
  type TierResolverPlugin,
  type TrialGate,
} from "./tier-resolver-extension.ts";
export {
  findOverDeepTransferChain,
  resolveTransferAdjacency as resolveEntityTransferAdjacency,
  type TransferAdjacency,
  type TransferEdge,
  type TransferEdgeLink,
} from "./transfer-adjacency.ts";
export { isSystemTenant, isUuid, parseTenantId, SYSTEM_TENANT_ID } from "./types/identifiers.ts";
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
  BeforeTransactionPhase,
  BeforeTransactionResult,
  BelongsToRelation,
  BigIntFieldDef,
  BooleanFieldDef,
  BootOptionName,
  CamelToKebab,
  ChatSendFailureCode,
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
  ConfigValidateContext,
  ConfigValidateFn,
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
  DashboardCurrencyFormat,
  DashboardCustomPanel,
  DashboardDateParam,
  DashboardFeedPanel,
  DashboardFilterDefinition,
  DashboardI18nText,
  DashboardListPanel,
  DashboardMoneyParam,
  DashboardPanelDefinition,
  DashboardPanelVisibility,
  DashboardProgressListPanel,
  DashboardProgressTone,
  DashboardRecordBinding,
  DashboardRefresh,
  DashboardRelativeTimeFormat,
  DashboardRelativeTimeParam,
  DashboardScreenDefinition,
  DashboardScreenPanel,
  DashboardStatGroupPanel,
  DashboardStatPanel,
  DashboardText,
  DashboardTextBlock,
  DashboardTextPanel,
  DashboardTextParam,
  DashboardValueFormat,
  DateFieldDef,
  DecimalFieldDef,
  DeleteContext,
  DeliveryErrorCode,
  DeliveryFailureCode,
  DeliverySkipReason,
  DeriveContext,
  DerivedFieldDef,
  DerivedFieldsMap,
  DerivedValueType,
  EditExtensionSection,
  EditFieldPrefill,
  EditFieldSpec,
  EditFieldsSection,
  EditLayout,
  EditRelatedListSection,
  EditSectionSpec,
  EmbeddedListEditSpec,
  EntityDefinition,
  EntityEditAction,
  EntityEditActionPlacement,
  EntityEditScreenDefinition,
  EntityId,
  EntityListExpandableRow,
  EntityListScreenDefinition,
  EntityObjectDefinition,
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
  HookDefinition,
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
  MaxPerTenantOptions,
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
  NotificationLocalizedTemplate,
  NotificationRecipientFn,
  NotificationRecordMapping,
  NotificationTemplateBody,
  NotificationTemplateFn,
  NotificationTemplateMeta,
  NotifyDeferred,
  NotifyDelivery,
  NotifyDeliveryStatus,
  NotifyDispatched,
  NotifyFactory,
  NotifyFn,
  NotifyJobDispatcher,
  NotifyOptions,
  NotifyPriority,
  NotifyResult,
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
  PreparedWriteEvent,
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
  SecretKeyDefinition,
  SecretKeyHandle,
  SecretMintConfirmStep,
  SecretMintScreenDefinition,
  SecretNamespaceDefinition,
  SecretNamespaceHandle,
  SecretNamespaceOptions,
  SecretReveal,
  SecretRevealField,
  SecretsEditScreenDefinition,
  SecretsEditSection,
  SelectFieldDef,
  SessionUser,
  SessionUserOrigin,
  StackBootRequirement,
  StreamHandlerDef,
  StreamHandlerFn,
  Subscribe,
  TargetRef,
  TemplateListVariableDef,
  TemplateScalarVariableDef,
  TemplateVariableDef,
  TemplateVariables,
  TenantId,
  TenantWriteTarget,
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
} from "./types/index.ts";
export {
  DEFAULT_CURRENCIES,
  DEFAULT_LOCALES,
  DELIVERY_FAILURE_CODES,
  DELIVERY_SKIP_REASONS,
  HookPhases,
  HTTP_ERROR_CODE_PATTERN,
  isAgentVisibleScreen,
  isDeliveryErrorCode,
  isOpenToAllGranted,
  resolveAgentExposure,
} from "./types/index.ts";
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
} from "./types/step.ts";
export { runValidation } from "./validation.ts";
