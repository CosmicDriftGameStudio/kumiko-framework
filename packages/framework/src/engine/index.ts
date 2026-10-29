// Public API

export {
  isAgentVisibleScreen,
  resolveAgentExposure,
} from "@cosmicdrift/kumiko-types/agent-exposure";
export type {
  ConfigAccessor,
  ConfigAccessorFactory,
  ConfigCascade,
  ConfigCascadeLevel,
  ConfigKeyDefinition,
  ConfigKeyHandle,
  ConfigKeyType,
  ConfigResolver,
  ConfigSecretsReader,
  ConfigValidateFn,
  ConfigValue,
  ConfigValueSource,
  ConfigValueWithSource,
  JobDefinition,
  JobHandlerFn,
  JobTrigger,
  NotificationDefinition,
  NotificationLocalizedTemplate,
  NotificationRecordMapping,
  NotificationTemplateBody,
  NotificationTemplateMeta,
  ReferenceDataDef,
  TemplateListVariableDef,
  TemplateScalarVariableDef,
  TemplateVariableDef,
  TemplateVariables,
  TranslationEntry,
  TranslationKeys,
} from "@cosmicdrift/kumiko-types/config";
export type { ConfigScope } from "@cosmicdrift/kumiko-types/config-scope";
export type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-types/event-type-map";
export type {
  ExtensionOptionsArgs,
  ExtensionOptionsFor,
  KumikoExtensionOptionsMap,
} from "@cosmicdrift/kumiko-types/extension-options-map";
export type {
  BootOptionName,
  SecretKeyDefinition,
  SecretKeyHandle,
  SecretNamespaceDefinition,
  SecretNamespaceHandle,
  SecretNamespaceOptions,
} from "@cosmicdrift/kumiko-types/feature";
export type { FeatureRegistrar } from "@cosmicdrift/kumiko-types/feature-registrar";
export type {
  DeriveContext,
  EntityDefinition,
  FieldDefinition,
  JsonbFieldDef,
  ResolvedPiiFlags,
  RetentionDef,
} from "@cosmicdrift/kumiko-types/fields";
export type {
  AccessRule,
  AgentHandlerHints,
  AgentRisk,
  AuthClaimsContext,
  BeforeTransactionResult,
  ChatSendFailureCode,
  ClaimKeyType,
  DeliveryErrorCode,
  DeliveryFailureCode,
  DeliverySkipReason,
  EscapeHatchAuditSink,
  EscapeHatchDeclaration,
  EscapeHatchKind,
  EscapeHatchUseEvent,
  EventDef,
  JobContext,
  JobDeferral,
  NotifyDelivery,
  NotifyDeliveryStatus,
  NotifyDispatched,
  NotifyFactory,
  NotifyFn,
  NotifyJobDispatcher,
  NotifyOptions,
  NotifyPriority,
  NotifyResult,
  QueryHandlerDef,
  RateLimitPer,
  RoleAccessPersonalData,
  RoleAccessRule,
  StreamHandlerDef,
  TenantWriteTarget,
  WriteEvent,
  WriteHandlerDef,
  WriteHandlerFn,
  WriteResult,
} from "@cosmicdrift/kumiko-types/handlers";
export {
  DELIVERY_FAILURE_CODES,
  DELIVERY_SKIP_REASONS,
  HTTP_ERROR_CODE_PATTERN,
  isDeliveryErrorCode,
  isOpenToAllGranted,
} from "@cosmicdrift/kumiko-types/handlers";
export type {
  DeleteContext,
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
  SaveContext,
  ValidationError,
  ValidationHookFn,
} from "@cosmicdrift/kumiko-types/hooks";
export type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
export type {
  ContentCollectionDefinition,
  NavDefinition,
  NavIconKey,
} from "@cosmicdrift/kumiko-types/nav";
export type {
  ProbeContext,
  ProbeCost,
  ProbeDefinition,
  ProbeOptions,
  ProbeScope,
  ProbeTarget,
  ProbeText,
  ProbeVerdict,
} from "@cosmicdrift/kumiko-types/probe";
export type {
  MspErrorMode,
  MultiStreamApplyFn,
  MultiStreamProjectionDefinition,
  ProjectionDefinition,
} from "@cosmicdrift/kumiko-types/projection";
export type { RelationDefinition } from "@cosmicdrift/kumiko-types/relations";
export type {
  ActionFormScreenDefinition,
  BundledListsOptions,
  ConfigEditScreenDefinition,
  DashboardCustomPanel,
  DashboardI18nText,
  EditFieldSpec,
  EditRelatedListSection,
  EditSectionSpec,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  FieldCondition,
  FieldFormatRegistry,
  ListColumnSpec,
  ListFacetSpec,
  ListTableOptions,
  MetricNavigate,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowAction,
  RowActionWriteHandler,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
  UnitKey,
} from "@cosmicdrift/kumiko-types/screen";
export type { TargetRef } from "@cosmicdrift/kumiko-types/target-ref";
export type {
  TreeAction,
  TreeActionDef,
  TreeChildrenSubscribe,
  TreeNode,
} from "@cosmicdrift/kumiko-types/tree-node";
export type { WorkspaceDefinition } from "@cosmicdrift/kumiko-types/workspace";
export { handlerFieldLabelKey, handlerTitleKey } from "../i18n/required-surface-keys.ts";
export { attachOutsideTransaction } from "../pipeline/attach-outside-transaction.ts";
export { hasAccess } from "./access.ts";
export type {
  PrincipalProfile,
  PrincipalStatus,
  PrincipalStatusPlugin,
  TenantLifecycleStatusPlugin,
} from "./active-membership.ts";
export { collectBootRuleViolations } from "./boot-validator/boot-report.ts";
export {
  type BootRule,
  type BootRuleTable,
  BootRuleViolation,
  BootValidationError,
  type BootViolation,
  bootRuleError,
} from "./boot-validator/boot-rule.ts";
export { validateBundledListsOptions } from "./boot-validator/bundled-lists-table.ts";
export {
  PII_DIRECT_NAME_HINTS,
  PII_USER_OWNED_NAME_HINTS,
  PII_USER_REFERENCE_NAME_HINTS,
} from "./boot-validator/entity-handler.ts";
export { entityHasAnonymizableSubjectField } from "./boot-validator/pii-retention.ts";
export {
  collectCardMetaOverflow,
  collectWriteHandlerQns,
  MAX_TRANSFER_DEPTH,
  SECURITY_BASELINE_FEATURE_NAMES,
  type ValidateBootOptions,
  validateAppCustomScreenWriteQns,
  validateBoot,
} from "./boot-validator.ts";
export { bridgeStub } from "./bridge-stub.ts";
export { buildAppSchema } from "./build-app-schema.ts";
export {
  buildConfigFeatureSchema,
  SETTINGS_HUB_FEATURE,
} from "./build-config-feature-schema.ts";
export { type PendingChange, parseChangesetChanges } from "./changeset-changes.ts";
export {
  access,
  createSeed,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createUserConfig,
  isEncryptedAtRest,
} from "./config-helpers.ts";
export type { LifecycleHookType } from "./constants.ts";
export {
  ConfigScopes,
  LifecycleHookTypes,
  TENANT_CURRENCY_CONFIG_KEY,
  tenantChannel,
} from "./constants.ts";
export { mayOverrideTenant } from "./cross-tenant.ts";
export { dedupeFeatures } from "./dedupe-features.ts";
export { defineFeature } from "./define-feature.ts";
export type {
  PagedQueryHandlerDefinition,
  QueryHandlerDefinition,
  WriteHandlerDefinition,
  WriteHandlerInput,
} from "./define-handler.ts";
export {
  definePagedQueryHandler,
  defineQueryHandler,
  defineWriteHandler,
} from "./define-handler.ts";
export { defineRoles } from "./define-roles.ts";
export { defineStep, getStep } from "./define-step.ts";
export type { WorkflowDefinition } from "./define-workflow.ts";
export { computeDefinitionFingerprint, defineWorkflow } from "./define-workflow.ts";
export type { ToggleReader } from "./effective-features.ts";
export { computeEffectiveFeatures, isToggleableFeature } from "./effective-features.ts";
export {
  createEntityExecutor,
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  // Legacy single-fn-with-verb-string API. Backwards compatibility — new
  // apps use the verb-specific wrappers above. Existing callers (integration
  // tests, old bundled-features) remain runnable without changes.
  defineEntityQueryHandler,
  defineEntityRestoreHandler,
  defineEntityUpdateHandler,
  defineEntityWriteHandler,
  defineProjectionQueryHandler,
  entityListSchema,
  MAX_LIST_LIMIT,
} from "./entity-handlers.ts";
export { parentVisibilityFor, referenceGroupLabels } from "./entity-list-runtime-options.ts";
export { declareEscapeHatch } from "./escape-hatch-declaration.ts";
export { CODEMOD_PLACEHOLDER_REASON_MARKER } from "./escape-hatch-reason.ts";
export { emitEvent, typedPayload } from "./event-helpers.ts";
export type { TenantResourceExtensionName } from "./extension-names.ts";
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
  extensionSelectorTargets,
  SELECTED_EXTENSIONS_QUERY,
  selectablePluginIds,
} from "./extension-selector-plugins.ts";
export { extensionUsageEscapeHatchReason } from "./extensions/escape-hatch-usage.ts";
export type {
  StorageProviderDestroyTenantHook,
  StorageProviderHookCtx,
} from "./extensions/storage-provider.ts";
export {
  isTenantDataExtensionHooks,
  type TenantDataDestroyHook,
  type TenantDataHookCtx,
} from "./extensions/tenant-data.ts";
export {
  isTenantResourceExtensionHooks,
  type TenantDestroyHookResult,
  type TenantResourceDestroyHook,
  type TenantResourceHookCtx,
} from "./extensions/tenant-resource.ts";
export type {
  TenantUserModel,
  UserDataDeleteHook,
  UserDataDeleteStrategy,
  UserDataExportHook,
  UserDataExportSnippet,
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
  createReferenceField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "./factories.ts";
export {
  type ChangelogEntry,
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
} from "./feature-changelog.ts";
export {
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
  filterReadFields,
  maskWriteOnlyFields,
} from "./field-access.ts";
export { DEFAULT_CURRENCIES, DEFAULT_LOCALES } from "./field-helpers.ts";
export { handlerFieldReference } from "./handler-field-references.ts";
export { withResponseData } from "./handler-helpers.ts";
export { HookPhases } from "./hook-helpers.ts";
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
} from "./membership-roles.ts";
export type { OwnershipMap } from "./ownership.ts";
export {
  from,
  normalizeAccessEntry,
  userCanWriteFieldRow,
} from "./ownership.ts";
export {
  pagedListSchema,
  pageRows,
} from "./paged-list.ts";
export { parseRefTarget, parseRefTargetEntityName } from "./parse-ref-target.ts";
export { buildPipelineSteps, stepsPipeline } from "./pipeline.ts";
export { ProbeFailure } from "./probe-failure.ts";
export { projectAppSchemaForRoles } from "./project-app-schema-for-roles.ts";
export { defineApply, defineMspApply, setFields } from "./projection-helpers.ts";
export { isValidQn, parseQn, QnTypes, qn, toKebab } from "./qualified-name.ts";
export { readClaim } from "./read-claim.ts";
export { createRegistry } from "./registry.ts";
export type { AssignableAppRoles } from "./role-assignment.ts";
export {
  assignableAppRolesFromUsages,
  assignableAppRolesOf,
  BUILT_IN_MEMBERSHIP_ROLES,
  canActorAssignRole,
  findForbiddenRoleAssignment,
  isAssignableByRole,
  mergeAssignedRoles,
} from "./role-assignment.ts";
export { runPipeline, runStepList } from "./run-pipeline.ts";
export {
  buildInsertSchema,
  buildUpdateSchema,
  fieldToZod,
  SYSTEM_ONLY_JSON_SCHEMA_KEY,
} from "./schema-builder.ts";
export {
  isFieldsEditSection,
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
  AppContext,
  BeforeTransactionContext,
  FeatureDefinition,
  HandlerAuth,
  HandlerContext,
  HandlerDb,
  HandlerDispatch,
  HandlerEvents,
  HandlerObservability,
  JobDispatch,
  JobEvents,
  JobObservability,
  QueryEvent,
  Registry,
  ReservationContext,
  SessionUser,
  TenantId,
} from "./types/index.ts";
export type {
  AwaitedEventType,
  PipelineCtx,
  StepInstance,
  StepResolver,
} from "./types/step.ts";
export { walkStepInstances } from "./walk-step-instances.ts";
export { withFormDerivations } from "./with-form-derivations.ts";
