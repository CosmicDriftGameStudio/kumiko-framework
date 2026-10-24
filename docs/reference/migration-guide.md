---
title: Migration Guide
description: Breaking changes and migration hints for Kumiko upgrades
status: reference
verified: 2026-10-24
---

# Migration Guide

This document lists breaking changes across all bundled features.
Use `kumiko upgrade` to check what's new since your current version.

## 0.390.0

### @cosmicdrift/kumiko-dev-server

**The dev server runs with row level security on**

runDevApp and createKumikoServer default to rowLevelSecurity "on" and run the dev stack as kumiko_app. On boot against a persistent dev database, the stack creates the role and transfers ownership of the database and of the public schema's tables, views and sequences to kumiko_app. The database user in DATABASE_URL needs the right to create roles, which the superuser of a local Postgres has. Code that reads tenant tables through a raw connection without a scope sees no rows in development; the boot does not detect this. runSchemaApply takes rowLevelSecurity, and the managed kumiko/schema.ts exports ROW_LEVEL_SECURITY from appConfig; the managed file updates on the next sync.

**Migration:** Pass rowLevelSecurity: "off" to runDevApp while fixing code paths without tenant context; the dev database keeps kumiko_app as owner. A server entry written by an older scaffold passes appConfig.rowLevelSecurity to runProdApp by hand once the app turns row level security on. Manual migration, there is no codemod.

### @cosmicdrift/kumiko-testing

**happy-dom and undici updated for security advisories**

The happy-dom range for the global registrator and the DOM test setup moves to ^21.0.4 (fixes GHSA-834V-8H66-3H79, incomplete fix for an unsanitized import alias leading to host code execution), undici is pinned to 7.30.1 (fixes GHSA-XJJ6-F33Q-929C, denial of service through an unhandled error on excessive content-encodings).

**Migration:** Bump @happy-dom/global-registrator (and happy-dom, if listed) to ^21.0.4 in the app's devDependencies; the kumiko-testing peer range is now ^21.0.4. happy-dom 21 is a major release: run the app's DOM test suite after the bump.

**extraContext factories get the raw db in the test stack and dev**

The test stack and dev now pass the enforcing pool to extraContext factories, as runProdApp does, so request-time services keep the ambient request scope and a tenant leak shows up in tests instead of only in production.

**Migration:** Services built in extraContext that read across tenants at request time, or that a test calls directly, must scope themselves: createTenantDb({ db, tenantId, mode: "system", reason: "<why>" }). Test code reads through stack.db.

**The test stack runs with row level security on as role kumiko_app**

setupTestStack creates the role kumiko_app (LOGIN NOSUPERUSER NOBYPASSRLS, password taken from TEST_DATABASE_URL) once, makes it owner of the test database and opens every pool as that role with rowLevelSecurity "on"; template databases are built the same way. stack.db runs in system scope and sees every tenant's rows as before. The new stack.unscopedDb is the enforced pool the services use, on which a statement without a scope sees no tenant rows. rowLevelSecurity: "off" in the stack options restores the superuser stack without policies. createTestDb takes applicationRole: true for the same setup.

**Migration:** App code that reads or writes tenant tables through a raw connection outside a request, a job or a TenantDb now sees no rows in integration tests. Test code that calls such a path directly runs it inside runInSystemRowLevelSecurityScope or runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), ...) from @cosmicdrift/kumiko-testing/helpers. Production code works through a TenantDb for the tenant, a job, a system-scoped handler or a granted unsafeRaw. Tests that need superuser rights on stack.db, such as CREATE EXTENSION, CREATE ROLE or event triggers, open their own connection from TEST_DATABASE_URL or use createTestDb(). Manual migration, there is no codemod.

### framework-core

**HandlerContext without wiring, hooks receive the HandlerContext**

HandlerContext has 19 members and no longer carries the AppContext wiring. ctx.services holds redis, cacheSync, jobRunner, searchAdapter, entityCache, secrets, kms, files, derivatives, configResolver, configEncryption, rateLimit, effectiveFeatures and masterKeyProvider; every key of an app's extraContext that the framework does not know now lives in ctx.services.extensions (it used to sit flat on the context through a spread, invisible to tsc). ctx.lifecycle holds afterCommit and afterRollback (replacing scheduleAfterCommit and scheduleAfterRollback), signal and runPreSave. ctx.tenants holds config (replacing configFor) and writeTarget (replacing forTenant). ctx.obs gains meter, and the flat log, tracer, _tenantId, systemUser and triggeredBy are gone; read ctx.user.tenantId and ctx.obs.log. JobContext no longer extends the shared wiring fields; it gets services and lifecycle.signal and keeps systemUser, triggeredBy and its job fields. All hooks (preSave, postSave, postSaveBatch, preDelete, postDelete, postDeleteBatch, preQuery, postQuery) and the system hook definitions receive the HandlerContext instead of the AppContext, and the batch hooks run on a real handler context built per flush. AppContext stays the flat boot wiring and declares services as never, so a handler or job context can no longer be passed to a function that takes an AppContext. The context of beforeTransaction no longer exposes ctx.systemDb.outsideTransaction, which was a hole next to the denied ctx.db.outsideTransaction. The member-resolution and pre-transaction contexts also drop the notify factories from ctx.services, and member resolution drops _fileProviderResolver, so neither can rebuild the denied notify or file storage. Helpers that took a structural context with an optional flat member read undefined once a handler context stopped carrying it; their shapes now make that a type error: requireSecretsContext, FileProviderContext (createFileProviderForTenant) and MailTransportContext (createTransportForTenant) take a required secrets key (handlers pass { secrets: ctx.services.secrets, user: ctx.user }), and CreateFileRefContext/UploadFileBytesContext read services.files, so a handler or job context passes straight in. bridgeStub accepts a services option.

**Migration:** Run kumiko-upgrade --apply; it runs the ctx-namespaces codemod. It rewrites ctx.redis, cacheSync, jobRunner, searchAdapter, entityCache, secrets, kms, files, derivatives, configResolver, effectiveFeatures and the other service members to ctx.services.*, scheduleAfterCommit and scheduleAfterRollback to ctx.lifecycle.afterCommit and afterRollback, signal to ctx.lifecycle.signal, configFor and forTenant to ctx.tenants.config and writeTarget, and hook parameters annotated AppContext to HandlerContext, including context.log to context.obs.log in the hook body. Keys of your extraContext that you read through a cast move to ctx.services.extensions. Listed for manual review: ctx.systemUser, ctx.triggeredBy and ctx._tenantId on a HandlerContext (read ctx.user), a handler or job context passed to a function that takes an AppContext (narrow that parameter to the members it reads), spread literals next to moved members, and a handler or job context passed to a parameter whose structural type reads a moved member (it would read undefined without a type error). Hand-built test contexts take services, lifecycle and tenants from bridgeStub({ services }).

**HandlerContext and JobContext use namespaces instead of flat members**

The roughly 40 flat members of HandlerContext are grouped by purpose, with no deprecated aliases. ctx.db.outsideTransaction replaces ctx.dbOutsideTransaction and ctx.outsideTransaction (the property is non-enumerable and sits on the same db object, so TenantDb identity stays intact; it is undefined in the member-resolution and before-transaction phases and in platform-metering tenant mode). ctx.events holds append, unsafeAppend, tryAppend, fetchForWriting, load, archive, restore, isArchived, snapshot and loadWithSnapshot. ctx.dispatch holds query, queryAs, write, writeAs, queryAsMember and queryProjection. ctx.auth holds resolveClaims and resolveActiveMembership. ctx.obs holds log, tracer, metrics and metricsFor, and ctx.obs.log is now always a Logger. JobContext gets the subsets events.append, dispatch.write/writeAs/queryAs/queryAsMember and obs.log/metricsFor. reserveBeforeTransaction and beforeTransaction receive the new ReservationContext and BeforeTransactionContext types, so the surfaces they deny no longer exist on the type. The deprecated _configAccessorFactory alias is removed; use configAccessorFactory. The cap-counter resolvers and the template-resolver PrepareContext now take ReservationContext instead of HandlerContext (type-level break for callers passing a full HandlerContext-typed value to a narrower position, and for wrappers declaring the old type). attachOutsideTransaction(db, outsideDb) from @cosmicdrift/kumiko-framework/engine gives hand-built contexts a db.outsideTransaction; it mutates the passed db with a non-enumerable property (Object.defineProperty) and returns the same object. bridgeStub now accepts log and dispatch options. AppContext stays flat, and the context handed to postSave, preDelete, postDelete and postQuery hooks still reads context.log; a separate hook context follows in a later release.

**Migration:** Run kumiko-upgrade --apply; it runs the ctx-namespaces codemod. It rewrites ctx.dbOutsideTransaction and ctx.outsideTransaction to ctx.db.outsideTransaction, ctx.appendEvent/unsafeAppendEvent/tryAppendEvent/fetchForWriting/loadAggregate/archiveStream/restoreStream/isStreamArchived/snapshotAggregate/loadAggregateWithSnapshot to ctx.events.append/unsafeAppend/tryAppend/fetchForWriting/load/archive/restore/isArchived/snapshot/loadWithSnapshot, ctx.query/queryAs/write/writeAs/queryAsMember/queryProjection to ctx.dispatch.*, ctx.resolveAuthClaims/resolveActiveMembership to ctx.auth.resolveClaims/resolveActiveMembership, and ctx.log/tracer/metrics/metricsFor to ctx.obs.*. Object literals typed as HandlerContext or JobContext (test mocks) are nested the same way. Sites the codemod cannot resolve are listed for manual review: spread literals, untyped receivers, and AppContext reads such as context.log in hooks, which stay as they are. Manual pattern { db: someDb, dbOutsideTransaction: x } becomes db: attachOutsideTransaction(someDb, x). Spread calls such as ...bridgeStub() next to moved members are reworked by hand; pass log/dispatch as bridgeStub options. Rename _configAccessorFactory to configAccessorFactory where you set it on an AppContext.

**Feature AST, pattern library and codemods moved to @cosmicdrift/kumiko-feature-ast**

Feature AST, pattern library and codemods moved to the new package @cosmicdrift/kumiko-feature-ast; kumiko-upgrade heals stale open lines in CHANGELOG.md

**Migration:** Import these names from @cosmicdrift/kumiko-feature-ast instead of @cosmicdrift/kumiko-framework/engine: AddEntityArgs, AddHookArgs, AddRelationArgs, AddWriteHandlerArgs, FeaturePatcher, FeaturePattern, FeaturePatternKind, FormFieldLabel, FormFieldSpec, FormInputType, HandlerHeaderUpdate, ParseError, ParseResult, PatternCategory, PatternChange, PatternChangeIssue, PatternChangesParseResult, PatternFormSchema, PatternId, RenderFeatureFileInput, SourceLocation, PATTERN_LIBRARY, VERSION_HEADER, addPattern, applyChanges, createFeaturePatcher, getPatternSchema, groupByCategory, parseFeatureFile, parsePatternChanges, parseSourceFile, removePattern, renderFeatureFile, renderPattern, replacePattern, updatePattern. Import CodemodOptions, CodemodReport, CodemodResult, FileAnalysis, ParsedHandlerInfo, analyzeFile, analyzeHandlerArrow, convertFile, generatePerformBlock, runCodemod, scanForCandidates from @cosmicdrift/kumiko-feature-ast/codemod instead of @cosmicdrift/kumiko-framework/engine/codemod. Add @cosmicdrift/kumiko-feature-ast to the dependencies of the importing package; the codemod does both. @cosmicdrift/kumiko-framework no longer installs ts-morph.

**Jobs append their own events with ctx.events.append**

Jobs no longer need escapeHatch or unsafeRaw plus the low-level event-store API to append their own feature's events. The same ownership and schema rules apply as in write handlers, and the append runs in its own transaction together with the inline projections.

**Migration:** JobContext has a new required field events.append. Code that builds a JobContext object by hand (boot seeds, test fixtures) and does not spread bridgeStub() adds an events.append that throws when the code under test never appends. Jobs that appended their own feature's events through escapeHatch or unsafeRaw switch to ctx.events.append({ type, aggregateId, aggregateType, payload }).

**Jobs see whether they can still defer (ctx.canDefer)**

ctx.canDefer is false when the run is inline or the maxDefers budget is used up, so a handler can write its terminal state instead of deferring into an UnrecoverableError. Behaviour of ctx.defer and the maxDefers failure is unchanged.

**Migration:** JobContext has a new required field canDefer. Code that builds a JobContext object by hand (boot seeds, test fixtures) adds `canDefer: false` unless the context really supports ctx.defer. Contexts built by the job runner or cast with `as unknown as JobContext` need no change.

**meilisearch is an optional peer dependency**

**Migration:** Apps that import @cosmicdrift/kumiko-framework/search/meilisearch add meilisearch to their own dependencies (bun add meilisearch@^0.58.0); without it that import fails at boot with a message that names the package. Apps without the Meilisearch adapter need nothing.

**Framework subpaths no longer export names without a user**

A name stays exported from a subpath of @cosmicdrift/kumiko-framework only if at least one consumer outside packages/framework imports it from that subpath (other Kumiko packages, samples, the framework docs, kumiko-enterprise, kumiko-platform, kumiko-studio and the seven apps). Names added since 0.389.0 stay public. 1236 names had no user and are removed from their subpath; 30 of them are deleted together with their code and tests, the rest stay inside the framework as internal modules without a public export. The public-exports baseline keeps the new, smaller surface. Removed names per subpath:
./compliance: AuthorityNotificationDeadline, BundleTier, OVERRIDABLE_PROFILE_KEYS, RetentionSpec, UserNotificationRequiredPolicy, describeDurationSpec, durationSpecToMs
./config: AppClientConfig, AppPortEntry
./es-ops: CreateSeedMigrationContextArgs, EsOperationAppliedBy, EsOperationType, RunPendingSeedMigrationsArgs, RunPendingSeedMigrationsResult, SeedMembershipRow, SeedTemplateResourceFilter, SeedTemplateResourceRow, SeedTenantRow, SeedUserRow
./engine: ActiveMembership, ActiveMembershipRejection, ActiveMembershipResult, AgentExposure, App, AppConfig, AppendEventArgs, AppendEventFn, AssignableFromRole, AuthClaimsFn, AuthClaimsHookDef, BeforeTransactionPhase, BelongsToRelation, BigIntFieldDef, BooleanFieldDef, BuildAppSchemaOptions, BuildManifestOptions, BuiltinQnType, CamelToKebab, CardMetaOverflow, ChangelogType, ClaimKeyDefinition, ClaimKeyHandle, ClaimKeyJsType, ClampInfo, ConcurrencyMode, ConcurrencyModes, ConfigBacking, ConfigDefinition, ConfigFeatureSchema, ConfigKeyAccess, ConfigMask, ConfigSeedDef, ConfigStoredRow, ConfigStoredRowWithSource, ConfigValidateContext, CreateEventDefOptions, CreateSeedOptions, CreateTenantSeedOptions, CreateUserSeedOptions, CustomScreenDefinition, CustomScreenRoute, DashboardChartPanel, DashboardCurrencyFormat, DashboardDateParam, DashboardFeedPanel, DashboardFilterDefinition, DashboardListPanel, DashboardMoneyParam, DashboardPanelDefinition, DashboardPanelVisibility, DashboardProgressListPanel, DashboardProgressTone, DashboardRecordBinding, DashboardRefresh, DashboardRelativeTimeFormat, DashboardRelativeTimeParam, DashboardScreenDefinition, DashboardScreenPanel, DashboardStatGroupPanel, DashboardStatPanel, DashboardText, DashboardTextBlock, DashboardTextPanel, DashboardTextParam, DashboardValueFormat, DateFieldDef, DecimalFieldDef, DerivedFieldDef, DerivedFieldsMap, DerivedValueType, EXTENSION_SELECTOR_HINT_KEY, EditExtensionSection, EditFieldPrefill, EditFieldsSection, EditLayout, EmbeddedListEditSpec, EmitCtx, EntityCrudRegistrar, EntityEditAction, EntityEditActionPlacement, EntityListExpandableRow, EntityObjectDefinition, EntityRef, EntityRelations, EscapeHatchReporter, EscapeHatchTarget, ExpandableRowGrouping, FeatureChangelog, FieldAccess, FieldIconKey, FieldRenderer, FileFieldDef, FilesFieldDef, Findability, FormDerivationScreen, FormWidth, FormatSpec, HANDLER_FIELD_REFERENCES_META_KEY, HandlerFieldPathSegment, HandlerFieldReference, HandlerFieldReferenceAtPath, HandlerFieldReferenceMeta, HasManyRelation, HookDefinition, HookMap, ImageFieldDef, ImagesFieldDef, JobBackoff, JobBackoffStrategy, JobTriggerEvent, KumikoEntityTypeMap, KumikoExtensionName, KumikoHandlerPayloadMap, KumikoHandlerResultMap, ListPaginationMode, ListSortDir, ListSortSpec, LongTextFindability, ManyToManyRelation, MaxPerTenantOptions, MemberReader, MessageKind, MetricSpec, MspErrorPolicy, MultiSelectFieldDef, NameOrRef, NotificationDataFn, NotificationRecipientFn, NotificationTemplateFn, NotifyDeferred, NumberFieldDef, OnDeleteStrategies, OnDeleteStrategy, OpenToAllAccessRule, OpenToAllDeclaration, OpenToAllPersonalData, OwnershipClause, OwnershipRef, OwnershipRule, PagedListRequest, PagedListRowValue, ParentRefDef, ParsedQn, ParsedRefTarget, PersonalAnnotations, PersonalAnnotationsLongText, PersonalAnnotationsNoFind, PersonalSubject, PipelineBuildCtx, PipelineDef, PlatformComponent, PluralForms, PreQueryHookFn, PreparedWriteEvent, ProjectionTable, QnType, QualifiedEventName, QueryHandlerFn, RecordHeaderSpec, RecordHeaderSubtitlePart, RegisterEntityCrudOptions, ResolveOptions, RowActionNavigate, RowActionNavigateBase, RowFieldExtractor, SETTINGS_HUB_WORKSPACE, SUSPEND_SENTINEL, ScreenFilter, ScreenFilterOp, ScreenNavSugar, ScreenSlots, SecretMintConfirmStep, SecretReveal, SecretRevealField, SecretsEditScreenDefinition, SecretsEditSection, SelectFieldDef, SessionUserOrigin, StackBootRequirement, StepBuilder, StepDef, StepFailureStrategy, StepKind, StepListOutcome, StepNamespace, StorageProviderExtensionHooks, StreamHandlerDefinition, StreamHandlerFn, Subscribe, SystemHookName, SystemHookNames, SystemHookPriorities, TENANT_TEARDOWN_STATUSES, TemplateImagesVariableDef, TenantDataExtensionHooks, TenantResourceExtensionHooks, TextFieldDef, TranslationValue, TranslationsDef, TreeActionsHandle, TreeNodeState, UnavailableSelectOption, UnsafeAppendEventFn, UserDataExtensionHooks, UserDataExtensionOptions, WorkflowInput, WorkflowTrigger, applyFormDerivations, availableSelectOptions, buildOwnershipClause, buildTarget, checkWriteFieldOwnership, checkWriteFieldRoles, combineClauses, createApp, createEventDef, createUserSeed, findUnavailableSelectOptions, formDerivationsOfSchema, handlerFieldReferences, isExtensionEditSection, isForbiddenMembershipRole, isFormDerivationInputMode, isPagedQueryHandler, isPrincipalStatusPlugin, isTenantLifecycleStatusPlugin, isWriteFormEditSection, listStepKinds, qualifyTranslationKey, readHandlerFieldReferences, resolveConfigOrParam, resolveName, runValidation, runsInLane, sortEntries, stripForbiddenMembershipRoles, tenantOverrideDenied, userCanCreateFieldRow, userCanReadFieldRow, userCanWriteFieldRow, validateChangelog
./engine/types: AccessRule, ActionFormScreenDefinition, ActiveMembership, ActiveMembershipRejection, ActiveMembershipResult, AgentExposure, AgentHandlerHints, AgentRisk, AggregateStreamHandle, AnyFileFieldDef, AppendEventArgs, AppendEventFn, AuthClaimsContext, AuthClaimsFn, AuthClaimsHookDef, BeforeTransactionPhase, BeforeTransactionResult, BelongsToRelation, BigIntFieldDef, BooleanFieldDef, BootCheckContext, BootCheckFn, BootOptionName, BundledListsOptions, CamelToKebab, ChatSendFailureCode, ClaimKeyDefinition, ClaimKeyHandle, ClaimKeyJsType, ClaimKeyType, ClientDerivedFieldDef, ConcurrencyMode, ConfigAccessor, ConfigAccessorFactory, ConfigBacking, ConfigBounds, ConfigCascade, ConfigCascadeLevel, ConfigComputedContext, ConfigComputedFn, ConfigDefinition, ConfigEditScreenDefinition, ConfigKeyAccess, ConfigKeyDefinition, ConfigKeyHandle, ConfigKeyType, ConfigMask, ConfigResolver, ConfigScope, ConfigSecretsReader, ConfigSeedDef, ConfigStoredRow, ConfigStoredRowWithSource, ConfigValidateContext, ConfigValidateFn, ConfigValue, ConfigValueSource, ConfigValueWithSource, ContentCollectionDefinition, CreateSeedOptions, CreateTenantSeedOptions, CreateUserSeedOptions, CustomScreenDefinition, CustomScreenRoute, DEFAULT_CURRENCIES, DEFAULT_LOCALES, DELIVERY_FAILURE_CODES, DELIVERY_SKIP_REASONS, DashboardChartMarkerKind, DashboardChartPanel, DashboardChartRangeOption, DashboardChartRanges, DashboardCurrencyFormat, DashboardCustomPanel, DashboardDateParam, DashboardFeedPanel, DashboardFilterDefinition, DashboardI18nText, DashboardListPanel, DashboardMoneyParam, DashboardPanelDefinition, DashboardPanelGate, DashboardPanelVisibility, DashboardProgressListPanel, DashboardProgressTone, DashboardRecordBinding, DashboardRefresh, DashboardRelativeTimeFormat, DashboardRelativeTimeParam, DashboardScreenDefinition, DashboardScreenPanel, DashboardStatGroupPanel, DashboardStatPanel, DashboardText, DashboardTextBlock, DashboardTextPanel, DashboardTextParam, DashboardValueFormat, DateFieldDef, DecimalFieldDef, DeclarativeEventMigration, DefaultCurrency, DeleteContext, DeliveryErrorCode, DeliveryFailureCode, DeliverySkipReason, DeriveContext, DerivedFieldDef, DerivedFieldsMap, DerivedValueType, DispatchWriteRef, EditExtensionSection, EditFieldPrefill, EditFieldSpec, EditFieldsSection, EditLayout, EditRelatedListSection, EditSectionSpec, EditWriteFormSection, EmbeddedDerivedCellDef, EmbeddedFieldDef, EmbeddedListEditSpec, EmbeddedSubFieldDef, EntityCrudRegistrar, EntityCrudVerb, EntityDefinition, EntityEditAction, EntityEditActionPlacement, EntityEditScreenDefinition, EntityEventMigration, EntityFieldDefinition, EntityHandlerOptions, EntityHookMap, EntityId, EntityIndexDef, EntityListExpandableRow, EntityListScreenDefinition, EntityLongTextFieldDef, EntityObjectDefinition, EntityProjectionExtension, EntityQueryHandlerOptions, EntityRef, EntityRelations, EntityTextFieldDef, EntityWriteHandlerOptions, EscapeHatchAuditSink, EscapeHatchDeclaration, EscapeHatchKind, EscapeHatchReporter, EscapeHatchTarget, EscapeHatchUseEvent, EventDef, EventMigrationDef, EventPiiFields, EventUpcastCtx, EventUpcastFn, ExpandableRowGrouping, ExtensionOptionsArgs, ExtensionOptionsFor, ExtensionSelectorDef, ExtensionSelectorPanel, FeatureMetricDef, FeatureMetricType, FeatureRegistrar, FetchForWritingArgs, FieldAccess, FieldCondition, FieldDefinition, FieldFormatRegistry, FieldIconKey, FieldRenderer, FieldsMap, FileFieldDef, FilesFieldDef, Findability, FormFieldDerivation, FormWidth, FormatSpec, FromRule, FromRuleKind, HTTP_ERROR_CODE_PATTERN, HandlerRef, HasManyRelation, HookDefinition, HookMap, HookOwner, HookPhase, HookPhases, HttpRouteDefinition, HttpRouteHandler, HttpRouteHandlerDeps, HttpRouteMethod, ImageFieldDef, ImagesFieldDef, JobBackoff, JobBackoffStrategy, JobContext, JobDeferral, JobDefinition, JobHandlerFn, JobRunnerRef, JobTrigger, JobTriggerEvent, JsonbFieldDef, KumikoEntityTypeMap, KumikoEventTypeMap, KumikoExtensionOptionsMap, KumikoHandlerPayloadMap, KumikoHandlerResultMap, LifecycleHookFn, LifecycleHookType, LifecycleResult, ListColumnSpec, ListEmptyStateSpec, ListFacetSpec, ListPaginationMode, ListSortDir, ListSortSpec, ListTableOptions, LocatedTimestampFieldDef, LongTextFieldDef, LongTextFindability, ManyToManyRelation, MaxPerTenantOptions, MemberReader, MetricNavigate, MetricOptions, MetricSpec, MoneyCurrencySource, MoneyFieldDef, MspErrorMode, MspErrorPolicy, MultiSelectFieldDef, MultiStreamApplyFn, MultiStreamProjectionDefinition, NameOrRef, NavDefinition, NavIconKey, NotificationDataFn, NotificationDefinition, NotificationLocalizedTemplate, NotificationRecipientFn, NotificationRecordMapping, NotificationTemplateBody, NotificationTemplateFn, NotificationTemplateMeta, NotifyDeferred, NotifyDelivery, NotifyDeliveryStatus, NotifyDispatched, NotifyFactory, NotifyFn, NotifyJobDispatcher, NotifyOptions, NotifyPriority, NotifyResult, NumberFieldDef, OnDeleteStrategy, OpenToAllAccessRule, OpenToAllDeclaration, OpenToAllPersonalData, OptionsQueryPayload, OptionsQueryPayloadValue, OwnedFn, OwnershipClause, OwnershipMap, OwnershipRef, OwnershipRule, ParentRefDef, PayloadBucketNormalization, PayloadRateLimitOption, PersonalAnnotations, PersonalAnnotationsLongText, PersonalAnnotationsNoFind, PersonalSubject, PhasedHook, PlatformComponent, PluralForms, PostDeleteBatchHookFn, PostDeleteHookFn, PostQueryHookFn, PostSaveBatchHookFn, PostSaveHookFn, PreDeleteHookFn, PreQueryHookFn, PreSaveHookFn, PreparedWriteEvent, ProjectionDefinition, ProjectionDetailScreenDefinition, ProjectionListScreenDefinition, ProjectionRowIdOf, ProjectionTable, QualifiedEventName, QueryHandlerDef, QueryHandlerDefinition, QueryHandlerFn, RateLimitDeclaration, RateLimitDisabled, RateLimitOption, RateLimitOptions, RateLimitPer, RecordHeaderSpec, RecordHeaderSubtitlePart, ReferenceDataDef, RegisterEntityCrudOptions, RegistrarExtensionDef, RegistrarExtensionHooks, RegistrarExtensionRegistration, RelationDefinition, ResolvedPiiFlags, ResolvedPiiStance, RetentionDef, RoleAccessPersonalData, RoleAccessRule, RowAction, RowActionNavigate, RowActionNavigateBase, RowActionWriteHandler, RowFieldExtractor, RunIn, SaveContext, ScreenDefinition, ScreenFilter, ScreenFilterOp, ScreenNavSugar, ScreenSlots, SearchPayloadContributorFn, SecretKeyDefinition, SecretKeyHandle, SecretMintConfirmStep, SecretMintScreenDefinition, SecretNamespaceDefinition, SecretNamespaceHandle, SecretNamespaceOptions, SecretOptions, SecretReveal, SecretRevealField, SecretsEditScreenDefinition, SecretsEditSection, SelectFieldDef, SelectOptionTone, SessionUserOrigin, SingleStreamApplyFn, SqlFragment, StackBootRequirement, StoreTableDef, StoreTableEntry, StoreTableOptions, StreamHandlerDef, StreamHandlerDefinition, StreamHandlerFn, Subscribe, TargetRef, TemplateImagesVariableDef, TemplateListVariableDef, TemplateScalarVariableDef, TemplateVariableDef, TemplateVariables, TenantWriteTarget, TimestampFieldDef, ToolbarAction, TransitionMap, TranslationEntry, TranslationKeys, TranslationValue, TranslationsDef, TreeAction, TreeActionDef, TreeActionsHandle, TreeChildrenSubscribe, TreeNode, TreeNodeState, TryAppendEventFn, TryAppendEventResult, TzFieldDef, UiExtensionDef, UiHintOption, UiHints, UnitKey, UnsafeAppendEventFn, ValidationError, ValidationHookFn, WebSocketMessageData, WebSocketRouteConnectDeps, WebSocketSessionHandlers, WhereRuleContext, WorkspaceDefinition, WriteEvent, WriteHandlerDef, WriteHandlerDefinition, WriteHandlerFn, WriteHandlerInput, WriteResult, declaredRateLimitOptions, isAgentVisibleScreen, isDeliveryErrorCode, isExtensionEditSection, isFileField, isFormatSpec, isOpenToAllGranted, isRateLimitDisabled, isRateLimitOption, isSystemTenant, isUiAccessGranted, isUuid, normalizeEditField, normalizeListColumn, parseTenantId, relatedListGroupHeaderLabel, relatedListGroupKey, resolveAgentExposure, resolveName, withResponseData
./env: ComposeEnvSchemaOptions, ComposedEnvShape, EnvError, EnvErrorKind, EnvFieldClass, EnvFieldStatus, KumikoEnvMeta, ParseEnvOptions, buildPulumiSuggestion, camelCase, getDefaultValue, getFieldDescription, pulumiConfigKey
./env/dry-run: DryRunOptions
./errors: AgentReason, AgentReasons, ErrorCtorInput, ErrorLogEntry, ErrorOpts, ErrorResponseBody, FeatureDisabledDetails, FrameworkReason, IdempotentReplayError, InvalidTransitionDetails, MemberReadTimeoutError, NotFoundDetails, PreconditionFailedDetails, PreconditionFailedError, RateLimitDetails, RateLimitUnavailableError, RecordLockedError, UnauthenticatedError, UnconfiguredDetails, UniqueViolationDetails, UnprocessableOpts, ValidationDetails, VersionConflictDetails, buildErrorLog, buildInvalidTransitionDetails, isSubjectErasedConflict, memberResolutionReadOnlyDenied, resolveErrorDocsUrl, serializeError, toKumikoError, toWriteErrorInfo
./db: AppliedMigration, ApplyResult, BaselineResult, BuildEntityTableMetaOptions, CompositePrimaryKeyMeta, CreateDbConnectionOptions, CreateTenantDbOptions, CursorQueryOptions, CursorResult, DbConnectionHandle, DbConnectionOptions, DecodedKeysetCursor, DeleteManyBatchedOptions, DeleteManyBatchedResult, EagerLoadEntityResolver, EagerLoadViewer, EagerloadedRow, EntityLifecycleVerb, EntityRow, EventStoreExecutorOptions, ExecutorManagedWriteCapability, FeatureTableSource, GenerateMigrationInput, GenerateMigrationOutput, IncrementCounterOptions, IndexMeta, InnerJoinRow, InnerJoinSpec, InsertOnConflictDoNothingOptions, JoinColumnPair, LocatedTimestampRead, LockGuardOption, Migration, MigrationChecksumMismatchError, OutsideTransactionContext, PgErrorInfo, PgType, ReplayMismatch, ReplayedSchema, ReplayedTable, RetiredFrameworkTable, SYSTEM_SCOPE_CHECK_BRAND, SchemaDiff, SelectQuery, Snapshot, TableColumns, TenantDbGrants, TenantDbMode, UnmanagedTableInput, UpsertOnConflictOptions, WhereOperator, WhereValue, Writable, assertUniqueTableNames, assertValidMigrationName, baselineMigrations, bigint, bigserial, collectReferenceFields, constraintOf, diffReplayAgainstSnapshot, diffSnapshots, encryptEntityFieldValues, enrichRowWithReferences, enrichWithReferences, executeRawQueryRead, fetchAppliedMigrations, findCommentedDropTables, flattenCompoundTypes, flattenLocatedTimestamp, flattenMoney, hasOutsideTransactionDb, instantToDriver, isRetiredFrameworkTable, isTableAlreadyExists, labelListAggregateGroups, loadMigrationsFromDir, moneyAmount, moneyPayloadToMinorUnits, numeric, readMigrationSqlTexts, readRebuildMarker, rebuildTablesFromDiff, rehydrateCompoundTypes, rehydrateLocatedTimestamp, renderMigrationSql, renderTableDdl, replayMigrationsDir, requireOutsideTransactionDb, retiredFrameworkTables, runInSavepoint, runMigrations, snapshotFromMetas, splitSqlStatements, toSnakeCase, toTableName, withoutStatementTimeout, writeRebuildMarker
./event-store: AppendEventInTenantDbOptions, ArchiveStreamArgs, ArchivedStreamError, DeadLetterRow, DeleteRowsWithoutReplayableStreamArgs, EVENTS_PUBSUB_CHANNEL, EventToAppend, EventUpcasters, IdempotentAppendConflictError, LoadAggregateWithSnapshotOptions, LoadAggregateWithSnapshotResult, PiiBackfillBatchOptions, PiiBackfillBatchResult, PiiBackfillFailure, PiiBackfillOptions, PiiBackfillResult, PiiBackfillScanCache, ProvenanceEventInput, RebuildDeadLetterRow, SaveSnapshotArgs, SkippedApply, Snapshot, SnapshotReducer, TransferAggregateStreamsArgs, UpcastOptions, UpcasterErrorPolicy, createRebuildDeadLetterTable, createSnapshotsTable, createUpcasterDeadLetterTable, listDeadLetters, listRebuildDeadLetters, loadAggregateAsOf, loadAggregateWithSnapshot, loadEventsAfterVersion, loadLatestSnapshot, rebuildDeadLetterTable, recordRebuildDeadLetters, recordUpcasterDeadLetter, restoreStream, saveSnapshot, toStoredEvent, upcastStoredEvents
./event-store/admin-api: RawEventToAppend
./pipeline: ACCESS_INVALIDATION_CONSUMER_NAME, AppendDomainEventCoreDeps, ConsumerCursor, ConsumerStatus, ConsumerTransitionRejection, DispatcherPassResult, EntityCache, EntityCacheOptions, EscapeHatchReportWindow, EventConsumer, EventConsumerBatchHandler, EventConsumerHandler, EventDispatcherOptions, FailedWriteResult, LifecycleHooks, MspRebuildDeps, MultiStreamApplyContextDeps, PendingGapEntry, ProjectionProgress, ProjectionStatus, ProjectionStatuses, PruneEventsResult, RebuildResult, ResolveAuthClaimsArgs, SystemHookDef, assertInstructionFieldWriteAllowed, createAccessInvalidationEventConsumer, createEscapeHatchReportWindow, createEventDispatcher, createSearchEventConsumer, createSseBroadcastEventConsumer, fallbackEscapeHatchReporter, isFailedWriteResult, isIrreversibleEntityVerb, reportEscapeHatchUse, selectConsumerCursorForUpdate, withEscapeHatchAuditScope
./api: AuthMiddlewareOptions, AuthSessionChecker, AuthSessionStatus, CachedResponseInit, ClientIpHeaderSource, ExtraRouteEntries, ExtraRouteEntry, ExtraRouteRejectionOptions, ExtraRouteRejectionStatus, HOST_COOKIE_PREFIX, JwtKeyring, JwtPayload, KumikoServer, KumikoServerWebSocket, PostAuthLandingFlow, RedisSseBrokerOptions, RequestContextData, ResolvedSessionCookies, SessionCookieBase, SessionCookieNames, SetTenantCookieOptions, SignatureExtraRoute, SignatureExtraRouteVerifyDeps, SseClient, SseRouteOptions, TENANT_COOKIE_BASE, TenantExists, TenantLifecycleStatusResolver, TenantResolver, UserExtraRoute, WEBSOCKET_DEFAULT_MAX_CONNECTIONS_PER_USER, WEBSOCKET_REVALIDATION_FAILURE_LIMIT, WebSocketUpgradeServer, assertValidTrustedProxyHops, authMiddleware, clientIpSourceFromHonoContext, createApiRoutes, createAuthRoutes, createJwtHelper, createSseRoute, deleteTenantCookie, extractSocketAddress, getUser, isHostPrefixedCookieName, isSafeLandingPath, kumikoWebSocketHandler, parseIfNoneMatch, patAllows, qnMatches, requestIdMiddleware, resolveSessionCookieNames, resolveSessionCookies, sessionCheckStatus, sessionCookiesMiddleware
./i18n: DEFAULT_LOCALE, I18n, I18nOptions, pickAcceptLanguage, rankAcceptLanguage, resolveHeaderLocale
./auth: Role
./files: BindPendingFileRefOutcome, CreateFileRefContext, DEFAULT_UPLOAD_SWEEP_GRACE_HOURS, FileAccessDecision, FileContentValidationResult, FileHandle, FileMetadata, FileProviderResolverDeps, FileRef, FileRoutesOptions, FileValidationOptions, MIN_UPLOAD_SWEEP_GRACE_HOURS, PendingFileRefBindTarget, UploadFileBytesContext, UploadMimeTypeResolution, WriteStreamOptions, createFileRoutes, createFileUploadLedger, fileRefStorageDelta, makeFileProviderResolver, parseMaxSize, resolveContentType, resolveUploadMimeType, sweepOrphanedUploads, validateFileContent
./derivatives: DerivativesContextDeps, StoredFileStore, VARIANT_NAME_PATTERN, canonicalJson, createDerivativesContext, isDerivativeKeyOf, listDerivativeKeys, resolveRenderer, specHash
./jobs: JobSubjectValue
./observability: ConsoleProviderOptions, Counter, ESCAPE_HATCH_USED_SIGNAL, EscapeHatchProcessDedup, EscapeHatchReportWindow, Gauge, Histogram, Meter, MetricDefinition, MetricEventHandler, MetricLabels, MetricType, ObservabilityWiring, PrometheusMeter, PrometheusMeterSnapshot, REDACTED, RecordingTracerOptions, STANDARD_METRIC_DEFS, SamplingConfig, SensitiveFilterConfig, SerializedTraceContext, Span, SpanAttributeValue, SpanAttributes, SpanKind, SpanStatus, StartSpanOptions, Tracer, UNATTRIBUTED_ACTOR, buildMetricName, createConsoleProvider, createEscapeHatchProcessDedup, createEscapeHatchReportWindow, createEscapeHatchReporter, createUnboundMetricsHandle, emitDbQuery, emitDispatcherError, emitDispatcherHandler, emitEscapeHatchUse, emitEventConsumerLag, emitEventConsumerPassOutcome, emitEventConsumerPassSkipped, emitEventConsumerPendingGaps, emitEventConsumerRearmExhausted, emitEventDispatcherListenConnected, emitHttpRequest, emitJobLastSuccess, emitJobQueueDepth, fallbackEscapeHatchReporter, flushEscapeHatchAudits, generateSpanId, generateTraceId, getFallbackMeter, getFallbackProvider, getFallbackTracer, observabilityContext, redactAttributes, redactHeaders, redactQueryString, redactValue, registerStandardMetrics, reportEscapeHatchUse, serializeOpenMetrics, serializeSpanContext, shouldRedactAttribute, validateLabelKey, validateMetricName, withEscapeHatchAuditScope, wrapRedisClient
./migrations: ChecksumMismatch, EnqueueProjectionRebuildDeps, EnqueueProjectionRebuildResult, KumikoDriftReport, PendingRebuildRun, PiiEventBackfillOptions, PiiEventBackfillResult, PiiRebuildRun, RunPendingRebuildsOptions, createPendingRebuildsTable, createPiiBackfillStateTable, detectKumikoDrift, formatKumikoDriftReport, pendingRebuildsTable, piiAnnotationFingerprint, piiBackfillStateTable
./entrypoint: AllInOneEntrypointOptions, BaseEntrypointOptions, PgClient, PgListenClient, WorkerEntrypointOptions
./random: ADJECTIVES, AdjNounNameOptions, GenerateUniqueNameOptions, NOUNS, generateAdjNounName, generateNoConfusableId
./redis: CacheSyncBusOverSignalOptions, PubSubSignal, PubSubSignalOptions, RedisCacheSyncBusOptions, ResolvedCacheSyncBus, createCacheSyncBusOverSignal, isTenantConfigSyncMessage, resolveCacheSyncBus
./search: ReindexEntityFailure, ReindexEntityOptions, ReindexEntityResult, SearchDocument, SearchOptions, SearchResult, collectSearchableFieldNames, configureTenantSearchIndex, deriveSearchAdapterConfig
./search/meilisearch: MeilisearchAdapterOptions, meilisearchDocId, meilisearchTenantIndex
./seeding: DEFAULT_SEED_IF_EXISTS, EventStoreSeedExisting, RunEventStoreSeedOptions
./secrets: ContainsSecret, DekCacheOptions, EnvMasterKeyProviderOptions, Envelope, KeyScope, Keyring, SecretAuditContext, SecretKeyRef, assertNoSecretLeak, isSecret
./crypto: ActiveKmsWiring, EncryptPiiOptions, EventPiiCatalog, KekSourceEnv, KekSourceOptions, KeyNotFoundError, KmsHealth, KmsWiringEnv, KmsWiringOptions, KmsWiringRelease, PII_CIPHERTEXT_PREFIX_JSON, PgKmsAdapter, PgKmsAdapterOptions, PgKmsRotationEnv, PlaintextPiiWiring, RECORD_ENTITY_PATTERN, RemoteCryptoKmsAdapter, RequestKmsCache, ResolveSubjectOptions, RewrapOptions, RewrapResult, SubjectDek, SubjectKey, blindIndexFieldName, buildPgKmsOptions, collectSearchableSubjectFields, computeBlindIndexValues, configureEventPiiCatalog, createRequestKmsCache, encryptEventPayloadPii, isLocalKeyKmsAdapter, subjectIdFromKey, subjectKeyForTenant
./logging: LoggerOptions, scrubLogValue
./schema-cli: RunSchemaCliOptions, SchemaCliOut
./consumer-cli: ConsumerCliOut
./upgrade-cli: ManualResolution, UpgradeCliOut, UpgradeMarkerManual, UpgradeMarkerResolvedManual, findCodemodScriptsRoot, findFeatureChangelogFiles, manualEntryId
./internal/request-context: RequestContextData, isAgentToolCallScope, readonlyRequestContext, runWithOrigin, runWithWriteOrigin, setRequestIdentity
./time: Clock, GeoAddress, GeoCoordinates, LocatedTimestampJson, TzContextOptions, createTzContextAsync
./ui-types: BooleanFieldDef, CardColumnRoles, CardRoleColumn, CustomScreenRoute, DashboardChartKind, DashboardChartRangeOption, DashboardChartRanges, DashboardChartTone, DashboardPanelGate, DashboardRecordBinding, DashboardRelativeTimeFormat, DashboardValueFormat, DateFieldDef, EditFieldPrefill, EntityEditActionPlacement, EntityListExpandableRow, EntityListFacetExtraOption, EntityWriteExcludedFields, ExpandableRowGrouping, FieldsOrGroupsSection, FileFieldDef, FilesFieldDef, ImageFieldDef, ImagesFieldDef, ListBadgeTone, ListColumnDisplay, ListRowMetaColumnType, ListRowMetaReference, ListTableDensity, MetricSpec, NumberFieldDef, OpenToAllAccessRule, OpenToAllDeclaration, OpenToAllPersonalData, OptionsQueryPayloadValue, PluralForms, ReferenceLookupSource, RoleAccessPersonalData, RoleAccessRule, ScreenFilter, ScreenFilterOp, SecretReveal, SecretRevealField, SecretsEditSection, SelectFieldDef, SystemReferenceLabel, TreeNode, TreeNodeState, UnavailableSelectOption, cardFileDisplayKind, explicitListScreenId, relatedListGroupHeaderLabel, relatedListGroupKey
./utils: compareByCodepoint, readPositiveIntEnv, stringifyJson, toSnakeCase
Deleted with their code (no internal replacement): ./auth Role; ./compliance describeDurationSpec, OVERRIDABLE_PROFILE_KEYS; ./crypto createRequestKmsCache, RequestKmsCache; ./db numeric, SelectQuery; ./engine BuiltinQnType, createUserSeed, HandlerFieldReferenceMeta, KumikoExtensionName, listStepKinds, MessageKind, resolveConfigOrParam, ResolveOptions, StorageProviderExtensionHooks, SystemHookName, UserDataExtensionHooks; ./errors AgentReason, buildErrorLog, ErrorLogEntry; ./observability createUnboundMetricsHandle, redactHeaders, redactQueryString, serializeSpanContext; ./pipeline ConsumerStatus, ProjectionStatus, ProjectionStatuses; ./search configureTenantSearchIndex; ./time createTzContextAsync.

**Migration:** None of the removed names had a user in any Kumiko repository, so no migration is expected. Internal names have no public replacement. The deleted names listed above are gone without a replacement; code that still imports one fails to compile and has to inline the few lines it needs. If you need one back, open an issue.

**preQuery hooks removed**

`r.hook({ type: "preQuery", … })` registered a hook that the query pipeline never called. The `preQuery` hook type, `PreQueryHookFn`, the `preQuery` slot of the hook maps and registrar extension hooks, and `registry.getPreQueryHooks` are removed. A `type: "preQuery"` registration is now a type error and throws at feature registration instead of being silently ignored.

**Migration:** No known users. Remove `r.hook({ type: "preQuery", … })` registrations; they never ran. To change a query payload, validate or transform it inside the query handler.

**createTenantDb mode system requires a reason**

The system scope a TenantDb opens for its statements now carries that reason, so a scope leak assertion names the call site. Tenant mode takes no reason.

**Migration:** Add `reason: "<why this access spans tenants>"` to every createTenantDb({ mode: "system" }) call. The reason must be a non-empty string literal: an empty reason throws InternalError at construction, and the internal-subpath-imports guard rejects a missing, empty or non-literal reason.

**RLS boot check tells known tables from orphaned ones**

With rowLevelSecurity on, the boot check lists tenant tables without row-level security in two groups. Tables the app schema knows point to kumiko schema generate. Tables no feature declares anymore, including retired framework tables, are named as orphaned and point to dropping them by migration. The check itself stays strict.

**Migration:** assertRowLevelSecurityBootState takes the known tables as a required third argument: pass knownTablesOf(features), both exported from the db subpath.

**rowLevelSecurity defaults to "on"**

Postgres row level security is on by default, system scopes carry a mandatory reason, and the event write path keeps the caller's tenant scope.

**Migration:** In the app repo, once with the bump: run `kumiko sync-managed --write` (the managed kumiko/schema.ts now reads `export const ROW_LEVEL_SECURITY = appConfig.rowLevelSecurity;`), then `kumiko schema generate` and commit the migration. It contains ENABLE and FORCE ROW LEVEL SECURITY plus the policies `kumiko_tenant_isolation` and `kumiko_system_tenant_read` for every tenant table. The schema apply (the migrate init container in production) creates them; there is no manual database step. Without the migration, boot at "on" refuses to start and names the unprotected tables.
The app's database role must not skip policies; boot refuses it otherwise. Check it as that role with `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user` (both must be false). Callers of createDbConnection without a mode now get "on"; tools that touch no tenant rows (schema baseline/status, the KMS key store) pass "off" explicitly, and the operator commands backfill-pii, waitlist-migrate, project and consumer run on an enforcing connection in system scope, so they work against both modes.
Way back: set `rowLevelSecurity: "off"` in kumiko.config.ts and run `kumiko schema generate`; the generated migration contains DISABLE ROW LEVEL SECURITY and drops the policies. At "off" runProdApp and runWorkerApp log a boot warning.

**Boot hooks with a db dependency get a system-scoped db at rowLevelSecurity "on"**

**Migration:** No action unless a hook relied on the unscoped pool. The anonymousAccess factory, enrichAnonymousAccess, the runProdApp `wire` hook and runWorkerApp `wireComponents` now receive a system-scoped db, the same in prod, dev and the test stack, so tenant resolution and boot reads see rows across tenants. Anything the anonymousAccess factory builds keeps that db at request time and therefore reads across tenants for anonymous callers: filter by the resolved tenant yourself. In prod, extraContext factories keep the ambient request scope; the test stack and dev still hand them a system-scoped db, so a service that needs cross-tenant reads at request time must scope itself.

**runInSystemRowLevelSecurityScope and systemScopedRunner take a reason**

**Migration:** Call runInSystemRowLevelSecurityScope("<why this access spans tenants>", fn) and systemScopedRunner(runner, "<reason>"). An empty or whitespace reason throws InternalError; the scope leak assertion names the reason.

**A projection write under a tenant scope can no longer land in another tenant**

applyEntityEvent keeps an ambient tenant scope instead of wrapping every write in a system scope. Writes for other tenants go through ctx.systemDb.acknowledgeCrossTenant in an r.systemScope() feature. Replays, rebuilds and global entities still write system scoped.

**Migration:** A command that writes an entity row for another tenant through ctx.db now fails with SQLSTATE 42501; move that write to ctx.systemDb.acknowledgeCrossTenant in an r.systemScope() feature.

### tenant

**Tenant streams and rows live on the system tenant, seed defaults changed**

Tenants created, renamed or toggled by a SystemAdmin whose session tenant was neither 0001 nor the SYSTEM tenant landed in the event stream, read row and search bucket of that session tenant, so later updates could not find them. The tenant entity is now declared systemStream with tenancy global, so every writer (create, update, enable and disable, request and cancel destruction, the destroy job stages) addresses the stream on SYSTEM_TENANT_ID. seedTenant, seedUser, seedAdmin and seedAdminGuarded default to createSystemUser(SYSTEM_TENANT_ID) and write the tenant to SYSTEM whatever tenant an explicit by acts from; managed-pages and compliance-profiles seeds default to createSystemUser(tenantId). Existing memberships written by an admin of another tenant sit on that admin's stream while read_tenant_memberships.tenant_id carries the member tenant; after the backfill streamTenantId equals tenantId for them. New export backfillTenantStreamTenants from the tenant feature, the boot step runStreamTenantBackfillOnBoot in server-runtime, EsOperationType gains "stream-migration", built on the generic backfillAggregateStreamTenants in shared (backfillUserStreamTenants keeps its signature).

**Migration:** Nothing to run: runProdApp (api, all-in-one) and runWorkerApp search for legacy tenant, membership and user streams on every boot, before the boot seeds respectively before the worker starts, and fix what they find. A boot with nothing left reads only events of other tenants than SYSTEM (plus the membership events) and does no rebuild or reindex. It merges split tenant streams onto SYSTEM_TENANT_ID, moves each membership stream to the tenantId of its payload, moves legacy user streams, removes stale search documents from the old buckets, and where streams moved rebuilds tenant:projection:tenant-entity, tenant:projection:tenant-membership-entity and user:projection:user-entity and reindexes the tenant and user search indexes. Legacy streams written by old pods during a rolling deploy are fixed on the next boot. A row in kumiko_es_operations (stream-tenant-backfill:<user|tenant>:derived-pending) marks a run in progress so that a crash after the moves still gets its rebuild and reindex. Parallel boots are serialized by a Postgres advisory lock; failures are logged (aggregateId, step, error) and retried on the next boot. A process without a search adapter leaves the work to one that has it. Library users can call backfillTenantStreamTenants or backfillUserStreamTenantsWithDerivedState directly. Code that read tenant streams with loadAggregate(db, tenantId, "tenant") or appended tenant events with the tenant id as stream tenant must use SYSTEM_TENANT_ID. Consumer workarounds that wrote tenant streams under a SystemAdmin `by` (for example an executor update with TestUsers.systemAdmin) are no longer needed, because the stream is always SYSTEM. Seeds that relied on the old by default (TestUsers.systemAdmin) now get the system user as audit actor. Apps without a search backend set `search: "none"` on runProdApp and runWorkerApp, otherwise the stream-tenant backfill stays deferred in every process that has no search adapter.

## 0.389.0

### @cosmicdrift/kumiko-renderer

**DataTable rowGrouping removed**

The client-side rowGrouping prop and the DataTableRowGrouping type are removed from the DataTable contract; grouping runs only through serverGroups. A custom DataTable primitive drops its rowGrouping handling.

**Migration:** delete rowGrouping from custom DataTable primitives and their callers; group lists through table.grouping on the screen

### @cosmicdrift/kumiko-server-runtime

**BootOptionName drops demoMode, seeds and signals**

No stack declared them in bootRequires, so their boot checks never ran. A name returns together with its check and a test once a stack needs it.

**Migration:** no known callers; remove "demoMode", "seeds" and "signals" from bootRequires options

### @cosmicdrift/kumiko-testing

**captureClosedConnectionError returns a Bun.SQL error**

The helper opens Bun.SQL pools, so the captured error has the code ERR_POSTGRES_CONNECTION_CLOSED instead of the postgres-js CONNECTION_CLOSED. The client of createTestDb is the connection handle's listenClient, the same Bun.SQL pool as before.

**Migration:** Tests that compared the captured error's code with CONNECTION_CLOSED compare with ERR_POSTGRES_CONNECTION_CLOSED or call isClosedConnectionError. Manual migration, there is no codemod.

**e2e tests fail after more than 8 app boots; the per-test client IP no longer disables the HTTP cache**

The test fixture sent the per-test X-Forwarded-For through context.route, which turns Chromium's HTTP cache off for the whole context, so every page.goto re-downloaded all assets and GET /api/schema. It now uses setExtraHTTPHeaders and the cache stays on. The fixture also counts GET /api/schema per test and fails a passing test that boots the app more than 8 times (default of the new maxAppBootsPerTest fixture option), and closes pages left open (window.open tabs) before the context closes.

**Migration:** Seed through tenant.api, tenant.seed and tenant.addUser instead of calling page.goto(APP_BASE_PATH) before every seed; each page.goto reloads the app. runMatrix and runScreenshots boot the app once per test themselves, so they need no change; only your own scenario flows or specs that navigate on purpose raise the budget with test.use({ maxAppBootsPerTest: <n> }). Manual migration, there is no codemod. The X-Forwarded-For header is now sent on every request of the context, including cross-origin ones.

### @cosmicdrift/kumiko-types

**DbConnection, DbTx and PgClient are Bun.SQL types and postgres is no longer a peer dependency**

DbConnection is SQL | RawDbClient, DbTx is TransactionSQL | RawDbClient and PgClient is SQL from the bun module, so the package type-checks against bun-types instead of postgres. The postgres peer dependency is removed.

**Migration:** Remove postgres from your dependencies unless your own code imports it. Annotations that named postgres.Sql or postgres.TransactionSql for framework handles become SQL and TransactionSQL from "bun", or the DbConnection and DbTx aliases. Manual migration, there is no codemod.

### framework-core

**Bun.SQL replaces postgres-js as the only Postgres driver**

createDbConnection opens a Bun.SQL pool and needs Bun 1.4.4 or newer, the first release that drops a cached statement plan after DDL on the same connection. The handle gains listenClient for LISTEN/NOTIFY. Server errors carry the code ERR_POSTGRES_SERVER_ERROR with the SQLSTATE in errno and the constraint name in constraint; connection failures carry ERR_POSTGRES_CONNECTION_CLOSED, ERR_POSTGRES_CONNECTION_REFUSED, ERR_POSTGRES_CONNECTION_TIMEOUT or ERR_POSTGRES_CONNECTION_FAILED. extractPgError, isUniqueViolation, isTableAlreadyExists, constraintOf and the newly exported isUndefinedTable read that shape. The onNotice option is removed, because Bun.SQL has no notice hook and drops server notices. The ssl option takes Bun's tls value (a boolean, "disable", "prefer", "require", "verify-ca", "verify-full" or a TLS options object); ssl true and a TLS object without rejectUnauthorized still verify the server certificate, as they did with postgres-js. DB_PROVIDER is refused at boot for every non-empty value, "postgres" included.

**Migration:** Read SQLSTATE and constraint only through extractPgError or the is* helpers from @cosmicdrift/kumiko-framework/db; a direct err.code === "23505" check or an err.constraint_name read no longer matches. Replace checks for CONNECTION_CLOSED, CONNECTION_ENDED, CONNECTION_DESTROYED or CONNECT_TIMEOUT with the ERR_POSTGRES_CONNECTION_* codes. Drop onNotice from createDbConnection calls. Remove DB_PROVIDER from every environment. Run on Bun 1.4.4 or newer in engines, CI and images. Code that imports postgres itself must declare its own dependency or move to Bun.SQL, since the framework no longer installs it. Manual migration, there is no codemod.

**Money list aggregates answer one value per currency**

A sum, avg, min or max measure over a money field in a list aggregate now answers [{ currency, value }] with value in minor units, one entry per currency in the matching rows, and never adds amounts of different currencies. Before, it answered one plain number over all currencies.

**Migration:** code reading measures of a money field from a list aggregate answer (executor.aggregate, answerListAggregate or the list query with aggregate) reads an array of { currency, value } instead of a number; take the entry of the wanted currency, value stays in minor units

**FeatureRegistrar types moved to @cosmicdrift/kumiko-types/feature-registrar**

**Migration:** Import FeatureRegistrar, HookDefinition, EntityObjectDefinition and RequiresApi from @cosmicdrift/kumiko-types/feature-registrar or from the engine barrel of @cosmicdrift/kumiko-framework; @cosmicdrift/kumiko-types/feature no longer exports them.

**relatedList groupBy replaced by table.grouping**

The groupBy key on a relatedList section and an entityList expandableRow is removed together with the RelatedListGroupBy type. Both group through table.grouping ({ field, label?, labels?, collapsedWhen? }): groups, counts and header measures come from one aggregate query over all matching rows instead of the loaded page, and each open group loads its own rows. An expandableRow takes only table.grouping with a fixed field; userChoice, fields and every other table option stay boot errors there. The boot validator reports a leftover groupBy with a pointer to table.grouping. ExpandableRowGrouping is the new type of an expandableRow's grouping.

**Migration:** move groupBy { field, collapsedWhen, label, labels } to table: { grouping: { field, collapsedWhen, label, labels } }; the bound query must accept aggregate (entityListSchema does, a hand-written query answers it with answerListAggregate). dateField and the {lastDate} placeholder have no replacement on an expandableRow, where totals stay off; on a relatedList a max measure in table.totals shows the latest date. Every group now gets a header: a group without label or labels entry shows its value instead of rendering headerless.

**Unused ProviderPluginContext helpers removed**

ProviderPluginContext, providerPluginContextFromHandler and providerPluginContextFromJob are gone. No plugin type or resolver used them, and the type exposed db handles without an audit user. Provider contexts stay the narrow FileProviderContext, MailTransportContext and InboundMailContext.

**Migration:** no known callers; use FileProviderContext, MailTransportContext or InboundMailContext

**provider selector option labels are unique per owner**

The selector field id of a provider form is qualified with its owner feature, so the translation keys of its option labels change.

**Migration:** move app translation overrides from config:entity:__config-edit__:field:provider:option:<value> to the owner-qualified field id, field:mail-foundation-provider:option:<value> or field:file-foundation-provider:option:<value>

### sessions

**isPrincipalBlocked is no longer exported from sessions**

The sessions export dropped its re-export of isPrincipalBlocked, which ignored isDeleted. isPrincipalRowBlocked from the user export covers status and isDeleted and is what the session callbacks use.

**Migration:** import isPrincipalRowBlocked (for a user row) or isPrincipalBlocked (for a bare status) from "@cosmicdrift/kumiko-bundled-features/user" instead of the sessions export

## 0.388.0

### @cosmicdrift/kumiko-renderer

**Input gets kind "code" and autoFocus on kind "text"**

Input has a new kind "code" (length, onComplete, autoFocus, autoComplete defaulting to one-time-code), a single real input shown as separate cells; onComplete fires once when input, paste or autofill reaches full length and the value holds digits only. kind "text" gains autoFocus.

**Migration:** custom Input implementations (PrimitivesProvider override) with an exhaustive switch over props.kind need a case "code"; delegating to DefaultInput from @cosmicdrift/kumiko-renderer/web is enough

### @cosmicdrift/kumiko-server-runtime

**billing boot option takes stripe and/or dodo**

billing.stripe is now optional and billing.dodo is new (priceToTier, oneOffPriceIds). At least one is required. resolveBillingOption returns features (an array) instead of feature, and one webhook route serves every provider on stripe.webhookPath or SUBSCRIPTION_WEBHOOK_PATH. DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_WEBHOOK_KEY are the env bridge.

**Migration:** Callers of resolveBillingOption use billing.features instead of billing.feature.

### billing-foundation

**A catalog with several providers no longer throws an ambiguous-provider error**

With more than one subscription provider mounted, billing-plans and start-plan-checkout used to throw. They now list the providers; start-plan-checkout answers with errors.providerRequired when several are offered and no providerName is given, and errors.providerNotOffered for an unknown one. Plugins have to set displayName.

**Migration:** Set displayName on custom subscriptionProvider plugins. Callers that send start-plan-checkout with several providers mounted must pass providerName.

### framework-core

**runAsDirectCallEntry renamed to runAsAgentToolCallEntry**

The internal request-context helper also marks its scope as an agent tool call, so the name now says so; it stays reserved for dispatchToolCall.

**Migration:** replace imports of runAsDirectCallEntry from @cosmicdrift/kumiko-framework/internal/request-context with runAsAgentToolCallEntry; the signature is unchanged

## 0.384.0

### framework-core

**Boot fails when a feature leaves a locale out of some of its translation keys**

Within one feature, every translation key must carry every locale that any key of the same feature carries. A missing locale or an empty string fails boot with one error listing all gaps. Features with a single locale across all keys are unaffected, as are locale packages. A plural object counts as present.

**Migration:** Add the missing locale to each listed key, or move that locale out of the feature into a locale package.

**Entity text fields must declare a personal stance**

FieldsMap requires the personal stance of text and longText fields by type, and boot throws for such a field without one. The name heuristic for PII-typical names stays a warning and only applies to other field types.

**Migration:** Move raw `{ type: "text" }` and `{ type: "longText" }` entity fields to createTextField / createLongTextField with `personal` ("self", "tenant", "ref", `{ of }`, or false with a `reason`). tsc shows each place.

## 0.383.0

### @cosmicdrift/kumiko-renderer

**HeaderActionsBar onError receives an ErrorNotice instead of a string**

The onError prop of HeaderActionsBar is now (notice: ErrorNotice | null) => void, where ErrorNotice is { message, requestId? }, so the error reference can be shown next to the message.

**Migration:** change the handler to read notice.message (and notice.requestId); a handler that stores the string only needs `notice?.message ?? null`

### @cosmicdrift/kumiko-server-runtime

**runProdApp requires trustedProxyHops in production**

In production runProdApp refuses to boot when neither the trustedProxyHops option, the auth option nor KUMIKO_TRUSTED_PROXY_HOPS is set. An explicit 0 is allowed. create-kumiko-app templates write KUMIKO_TRUSTED_PROXY_HOPS=0 into .env.example.

**Migration:** set KUMIKO_TRUSTED_PROXY_HOPS=<hops> (0 when the app is exposed directly) or pass trustedProxyHops

### @cosmicdrift/kumiko-types

**MetricSpec requires the object form with a label**

The plain string shorthand for projectionDetail `metrics` is removed and `label` (an i18n key) is required, so a metric can no longer render as a bare column name. `metricField()` is removed from the screen exports because it is trivial now; read `metric.field`. The `metrics` entry without label check in the Screen-Conventions guard is dropped, the type enforces it.

**Migration:** Replace `metrics: ["balance"]` with `metrics: [{ field: "balance", label: "<i18n key>" }]`, reusing the key you had in `fieldLabels` for that column. Replace `metricField(metric)` with `metric.field`.

**EditFieldsSection is either fields or groups**

EditFieldsSection is now a union of a section with `fields` and a section with `groups`; the groups branch has no `fields` key, so a raw `section.fields` read on a section does not compile and `fields: []` next to `groups` is no longer needed. The boot validator rejects a section that declares both, including `fields: []`. FieldsOrGroupsSection now has optional `fields` and `groups`. Read a section's fields through `sectionFieldSpecs`, which the Section-Fields-Raw guard used to enforce.

**Migration:** Remove `fields: []` from every section that declares `groups`. Code that reads `section.fields` or `section.groups` of a fields section uses `sectionFieldSpecs(section)` or narrows with `"groups" in section`.

### framework-core

**Placeholder reasons are rejected at boot and at runtime**

An empty, whitespace-only or placeholder reason ("todo", "tbd", "fixme", "legacy", "temp", "wip", "n/a", "none", "xxx", a "todo:" / "fixme:" / "tbd:" prefix, or the migrate-cross-tenant codemod marker) now fails boot for `openToAll.reason` and `escapeHatch.reason`, and throws at call time for `ctx.systemDb.unsafeRaw(reason)`, `acknowledgeCrossTenant(reason)`, `unsafeAllTenants: { reason }` on read steps and `declareEscapeHatch({ reason })`, which is no longer a no-op. The Escape-Hatch-Declared and Open-To-All-Reason guards that checked this statically are removed.

**Migration:** Replace every placeholder reason with the real justification (why this access is needed and on whose right). Reasons held in imported constants were never judged by the guards and surface now, at boot or on first use.

**loadAllEventsByType and LOAD_ALL_EVENTS_ROW_LIMIT are removed**

loadAllEventsByType buffered every event of an aggregate type in memory and had no production caller. It is removed together with LOAD_ALL_EVENTS_ROW_LIMIT and the Loadall-Events guard.

**Migration:** Use `await Array.fromAsync(streamAllEventsByType(db, aggregateType))`, or iterate the stream with `for await` to stay memory-bounded. The stream is ordered by event id; loadAllEventsByType ordered by (createdAt, id).

**metricField is removed from the screen type exports**

metricField is removed from the engine types and ui-types exports because MetricSpec is always an object now.

**Migration:** Replace `metricField(metric)` with `metric.field`.

**globalIpRateLimit and httpRouteRateLimit option onFailClosed is now onFailOpen**

The option is renamed because both limits now let the request through on a Redis error; the callback receives the error and is throttled to one warning per 30 s. Both limits also accept a meter for kumiko_rate_limit_fail_open_total.

**Migration:** rename onFailClosed to onFailOpen in globalIpRateLimit and httpRouteRateLimit options; the callback no longer implies a 503, the request continues

### jobs

**Job handlers can return ctx.defer(ms)**

A handler that returns ctx.defer(ms) moves the queue job to delayed and runs again after ms, like the maxPerTenant defer. It consumes no retry attempt and records no failure, failure log or failed run; the run row of the deferred pass is removed and a tenantVisibleRun record goes back to queued. maxDefers on the job (default 100, shared counter with maxPerTenant defers) bounds the loop; exceeding it fails the run for good (no retry) with a clear message. Inline runs (boot gates) throw. New run-logger hook onJobDeferred, passed through the entrypoint jobs options. JobHandlerFn may now return a JobDeferral. JobContext has a required defer member.

**Migration:** add defer to every hand-built JobContext object (tests, seeds), e.g. defer: (delayMs) => ({ kind: "job-deferral", delayMs })

## 0.380.0

### framework-core

**Writes compile only for Writable tables or capable runners**

The negative ExecutorOnly brand is replaced by positive brands. table(), defineUnmanagedTable and deriveEntityTableMeta with source "unmanaged" return Writable tables; buildEntityTable and r.projection tables do not. insertOne, updateMany, deleteMany, the upsert and counter helpers and the TenantDb and db.global() write methods accept a Writable table, or any table when the runner is an ExecutorManagedRunner or ExecutorManagedTenantDb. Widening a table to SchemaTable or EntityTableMeta drops the brand, so erased tables no longer compile. Projection apply functions receive tx as ExecutorManagedRunner. The runtime lock is unchanged.

**Migration:** Apply functions that annotate `tx` as `DbRunner`, inline or standalone, type it as `ExecutorManagedRunner` (or drop the annotation / annotate the function with SingleStreamApplyFn/MultiStreamApplyFn). Own write helpers take `WritableTable` for direct-write tables, or `ExecutorManagedRunner` / `ExecutorManagedTenantDb` when they write event-fed tables from an apply, rebuild or tenant-destroy context, instead of `SchemaTable`/`EntityTableMeta`. Tables annotated as `SchemaTable` lose the `Writable` brand; drop the annotation or add `& Writable`. Tenant-destroy hooks keep using the db they receive. Affects kumiko-enterprise, solon, money-horse, kumiko-studio, publicstatus.

## 0.379.0

### @cosmicdrift/kumiko-dev-server

**kumiko check managed rejects loose Kumiko pins and a missing infraRef**

In an app, all @cosmicdrift/kumiko-*, create-kumiko-app and @cosmicdriftgamestudio/kumiko-* dependencies must be exact versions (workspace specs are allowed) on one version per scope. A private app without kumiko.deploy.infraRef is an error instead of a warning. In @cosmicdrift/kumiko-dev-server, listManagedWarnings is now listManagedErrors and ManagedCheckResult.warnings is now errors.

**Migration:** Pin the Kumiko dependencies without ^ or ~ and to one version per scope. Set kumiko.deploy.infraRef to an infra tag (reusables-vX.Y.Z) in package.json. Programmatic callers: rename listManagedWarnings to listManagedErrors and ManagedCheckResult.warnings to errors.

### @cosmicdrift/kumiko-renderer

**Forms ask before unsaved input is discarded**

A dirty entity form or writeForm section now asks with the discard dialog before an in-app navigation, a projectionDetail tab switch, browser back or forward, and the browser asks on tab close or reload (beforeunload). A successful save clears the form before its follow-up navigation, and wizards with layout.draft keep their draft instead of asking. requestLeave, hasUnsavedInput and useUnsavedInputSource are exported for custom screens.

**Migration:** End-to-end tests that fill a form and then navigate away without saving now meet the dialog (testId leave-guard-dialog); confirm it or save first. page.goto from a dirty form triggers the browser's beforeunload prompt.

**Form writes carry a requestId and reuse it only for a safe retry**

The form controller passes { requestId } as third argument to dispatcher.write. After a transport failure without a server answer, a submit with the same values reuses the requestId, so the server idempotency guard does not run the write twice; any server answer or changed values get a new one. generateRequestId moved to the headless dispatcher module.

**Migration:** Tests that assert a mocked dispatcher.write with toHaveBeenCalledWith(type, payload) must accept the third argument, e.g. toHaveBeenCalledWith(type, payload, expect.objectContaining({ requestId: expect.any(String) })). Custom Dispatcher implementations should forward options.requestId.

### @cosmicdrift/kumiko-types

**HandlerContext.outsideTransaction removed**

The deprecated outsideTransaction field no longer exists on HandlerContext. ctx.dbOutsideTransaction together with runInOwnTransaction replaces it.

**Migration:** Replace ctx.outsideTransaction(fn) with runInOwnTransaction(requireOutsideTransactionDb(ctx), fn); both are exported from @cosmicdrift/kumiko-framework/db and fn keeps its (db) => Promise signature. Since #4031 the two helpers are internal and no longer exported from /db; narrow ctx.db.outsideTransaction directly (if (ctx.db.outsideTransaction)).

### form-draft

**Form draft content is encrypted per owner**

The jsonb field draft carries personal: { of: "ownerId" }, so its content is stored as ciphertext in events and in read_form_drafts; the delete event no longer keeps the plaintext in previous. The PII event backfill (jsonb-objects-v3) encrypts existing events once on the next boot and rebuilds the table. The column type stays jsonb, so there is no schema change.

**Migration:** Nothing to run; the backfill happens on boot. Code that reads read_form_drafts.draft with raw SQL must decrypt it (decryptPiiFieldValues) or use the form-draft lookup helpers; the get and list queries are unchanged for clients.

### framework-core

**SSE entity signals follow the read access of the connection**

A signed-in connection receives an entity signal only when a query reading that entity lets one of its roles in (SseRouteOptions.entityReadAccess, built by collectEntityReadAccess). Entities without a reading query no longer go on the channel. When the reading access depends on a row or owner filter, the signal goes out without id and version, so a client refetches its query instead of learning which row changed.

**Migration:** Apps that rely on a signal for an entity no query exposes to the user must add a query for that entity with a matching access rule. Custom buildServer callers that build SseRouteOptions themselves must pass entityReadAccess.

**Global IP rate-limit middleware default matches runProdApp**

globalIpRateLimit defaults to 600 requests per 60 seconds (was 1000). DEFAULT_GLOBAL_RATE_LIMIT is exported from the api barrel and shared with server-runtime. authEndpointRateLimit keeps its default of 5 per 60 seconds.

**Migration:** Apps that use globalIpRateLimit directly and relied on 1000 pass limit explicitly. runProdApp users see no change.

**Direct writes on event-fed tables throw at runtime**

buildEntityTable and r.projection mark their tables. insertOne, updateMany, deleteMany, the upsert and counter helpers, ctx.db write methods and db.global() writes throw AccessDeniedError on a marked table unless the runner carries the framework write capability. The executor, projection apply, rebuild, unsafeProjectionDelete, tenant-destroy hooks and deleteRowsWithoutReplayableStream hold it; ctx.db.unsafeRaw() never does. Retention deletes only rows whose stream is gone or archived. The cascade delete hook, the soft-delete purge jobs and seedReferenceData now write through the executor, so their effect survives a rebuild; cascade children are written as the system user, and softDelete children are soft-deleted instead of hard-deleted. The direct-entity-writes guard has no exceptions left.

**Migration:** Write event-fed rows through the executor (r.crud, ctx.write, createEventStoreExecutor). Projection apply functions must use the db they receive. Test seeds and teardown use seedRow, seedRows, updateRows, deleteRows and clearTables from kumiko-testing instead of hand-written wipe helpers. Do not pass ctx.db.unsafeRaw() to code that deletes event-fed rows; pass ctx.db inside a tenant-destroy hook. Retention code calls deleteRowsWithoutReplayableStream after pruning or archiving the events. seedReferenceData takes the registry instead of a table map. Affects kumiko-enterprise, kumiko-studio and solon.

**buildEntityTableMeta and observabilityOptions removed**

buildEntityTableMeta was a deprecated alias of deriveEntityTableMeta. The deprecated observabilityOptions option of the entrypoint and the prod and worker runners is gone as well, it had no effect since the HTTP route label no longer carries a query string.

**Migration:** Rename buildEntityTableMeta to deriveEntityTableMeta (same signature). Delete observabilityOptions from the entrypoint and runner options, nothing replaces it.

**Re-export shim packages removed**

The shims headless, dispatcher-live, renderer-web, http and repo-manifest are gone. Their code lives in kumiko-renderer (/headless, /live, /web), kumiko-framework (/http) and kumiko-guards (/repo-manifest).

**Migration:** Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites the imports and package.json dependencies of all five shims to their target packages.

**TenantDb.databaseNow**

TenantDb has a databaseNow() method returning Postgres now(); custom TenantDb implementations must add it.

**Migration:** Add databaseNow(): Promise<Date> to hand-built TenantDb objects and mocks, returning the Postgres now().

### presets

**dsgvoSelfServiceFeatures removed**

The deprecated preset dsgvoSelfServiceFeatures and its DsgvoSelfServiceOptions type are gone. composeGdprStack covers the same features.

**Migration:** Use composeGdprStack({ selfService: { userDataRights } }), or mount createSessionsFeature, createDataRetentionFeature, createComplianceProfilesFeature, createUserDataRightsFeature and createUserProfileFeature yourself.

### template-resolver

**Overrides of locked templates are no longer served**

A tenant override of a mail, PDF or layout template is delivered (mail send, PDF render, linked PDFs, layouts, previews, export bundles, document blocks, overview, text blocks) only while the template is listed in tenantEditable. A locked override stays stored and has no effect; listing the template makes it effective again, nothing is deleted. A SystemAdmin sees locked overrides in the overview (`lockedOverride`, `lockedOverrideI18nKey`) and can reset or archive them with the existing handlers; the template-resolver queries do not show them to a TenantAdmin; the audit log keeps the history. Tenant rows of a collection mounted with `access` are served, except for a slug that has a system template outside tenantEditable: that system template wins, and the collection `-set` handler refuses such a slug for a non-SystemAdmin. createTemplateResolverApi(db) became createTemplateResolverApi(db, registry) because the delivery policy is read from the mounted feature; without the mounted feature no tenant override is served.

**Migration:** Overrides of templates that are not tenantEditable are no longer served; enable the template via tenantEditable to keep using them. Pass the registry as second argument to createTemplateResolverApi (ctx.registry in handlers, stack.registry in tests). Tenant rows without a system counterpart (for example text blocks seeded directly into a tenant) are hidden as well unless listed in tenantEditable.

## 0.378.0

### @cosmicdrift/kumiko-document-designer

**Designer screens are SystemAdmin-only unless the app passes access**

The templates screen, layout, PDF and mail editors are visible to SystemAdmin only by default. createDocumentDesignerFeature takes an optional access rule whose roles are added.

**Migration:** Pass createDocumentDesignerFeature({ access: templateEditAccess(tenantEditable) }) with the same entries given to the template resolver when TenantAdmins edit templates.

### @cosmicdrift/kumiko-renderer

**Renderer stylesheet no longer scans the document designer**

The renderer stylesheet stopped scanning the document designer sources by relative path, which broke in isolated installs.

**Migration:** Apps that embed the document designer add `@import "@cosmicdrift/kumiko-document-designer/web/styles.css";` after the renderer stylesheet import in their styles.css.

### framework-core

**Boot check for projectionList writeHandler actions**

Boot now rejects projectionList rowActions and toolbarActions of kind writeHandler whose handler is not a registered write-handler QN. Such actions only failed on click before.

**Migration:** Fix the handler QN to "<feature>:write:<short>" of a handler declared via r.writeHandler(...), or remove the action. Apps that fail to boot name the screen and action id in the error.

### template-resolver

**Template editing is SystemAdmin-only unless the app unlocks it**

Every tenant write handler, the overview and resource upload accept SystemAdmin only, plus the roles of the tenantEditable entries. A write on a template that is not unlocked fails with templateNotTenantEditable. The test send follows the same rule. For a non-SystemAdmin an unknown template id answers 403 like a locked one, so the response does not reveal whether it exists. Collections without an access rule default to SystemAdmin.

**Migration:** Where TenantAdmins must keep editing a template, pass tenantEditable to createTemplateResolverFeature, for example tenantEditable: [{ kind: "mail", slug: "billing:notify:invoice-issued", access: { roles: ["TenantAdmin"] } }]. Give template collections an explicit access rule if tenants should manage them.

## 0.377.0

### @cosmicdrift/kumiko-types

**JobContext._userId removed**

The job runner never set JobContext._userId; only user-data-rights read it, falling back to SYSTEM_USER_ID. Hand-built JobContext objects that still set it fail to type-check, and code that read it must use SYSTEM_USER_ID or the job's system user.

**Migration:** Drop _userId from hand-built JobContext objects (tests, job helpers) and replace reads of ctx._userId with SYSTEM_USER_ID. Known hits - money-horse data-export integration test, offlot-app channel-text generate-texts.job.ts.

### framework-core

**Provider contexts expose auditUserId instead of _userId**

FileProviderContext, MailTransportContext, InboundMailContext and the context read by requireSecretsContext name the audit identity auditUserId. The old underscore field is gone.

**Migration:** Rename _userId to auditUserId wherever a provider context is built by hand (tests, custom resolvers, worker wiring). requireSecretsContext still falls back to ctx.user.id when it is unset.

## 0.376.0

### @cosmicdrift/kumiko-server-runtime

**effectiveFeatures is gone from runProdApp, runDevApp and runWorkerApp**

The effectiveFeatures option of the boot functions is removed. Global operator switches come from the featureToggles option, tier gating from the tier-engine feature, which the boot functions wire themselves.

**Migration:** Replace a hand-built effectiveFeatures resolver with featureToggles true (global switches) and mount createTierEngineFeature for tier gating. A custom resolver that did neither has no replacement on the boot functions; wire it through createKumikoServer or setupTestStack in tests. The boot functions now abort when the option is still passed, because an ignored option would drop an operator kill-switch silently; the same goes for a feature-toggles feature in features without the featureToggles option, or with it set (the option mounts the feature).

**The default mail resolver only reaches members of the notifying tenant**

The default resolveEmail of the mail boot option returns an address for a notification from a tenant other than the system tenant only if the user is a member of that tenant or holds the SystemAdmin role in the stored user row. Everyone else resolves to null and the mail is skipped. The new option mail.recipientScope takes "membership" (default) or "any", which restores the old behaviour of reaching every user. EmailChannelOptions resolveEmail now receives the tenant database as TenantDb instead of unknown.

**Migration:** Apps that notify users outside the notifying tenant on purpose, for example merchants reached from a SystemAdmin context, set mail recipientScope to "any" or keep their own resolveEmail. Apps whose notifications go to members of the active tenant need no change. Known consumers on the default: offlot-app (main.ts) reaches merchants and SystemAdmins across tenants and needs recipientScope any; publicstatus (main.ts), show-pony, solon (main.ts) and kumiko-studio (main.ts) take the default, which fits notifications to members of the active tenant. money-horse and phronexsis keep their own resolveEmail. Per-app resolvers that only copied the membership check can be deleted. A custom resolveEmail that cast ctx.db can drop the cast.

### @cosmicdrift/kumiko-testing

**Test stack and seed helpers moved to @cosmicdrift/kumiko-dev-server/testing**

setupAppTestStack, SetupAppTestStackOptions, seedTenant, persistTenantRows and createE2eSeedRoutes are no longer exported from @cosmicdrift/kumiko-testing; the bundled-features and dev-server optional peers are gone.

**Migration:** Import the five names from @cosmicdrift/kumiko-dev-server/testing and add @cosmicdrift/kumiko-dev-server to your dependencies; run bun kumiko-upgrade --apply to rewrite the imports. Namespace imports are listed as manual.

## 0.374.0

### cap-overview

**tenant-caps:list pages by offset and rejects cursor**

The cap overview list showed page 1 on every page because the pager sends offset and the query only read cursor. tenant-caps:list now takes offset like the pager; a cursor in the payload is rejected with a 400 validation error and sort is an enum of the sortable fields. The unused cap-overview.errors.invalidCursor and sortFieldUnsupported keys are gone.

**Migration:** Callers of cap-overview:query:tenant-caps:list must send offset instead of cursor, and only a sortable field name as sort. Apps that override the removed i18n keys cap-overview.errors.invalidCursor or cap-overview.errors.sortFieldUnsupported can delete them. No caller in the kumiko-enterprise, kumiko-platform, kumiko-studio or app repos sends a cursor or defines these keys.

### framework-core

**DashboardChartPanel.valueFormat only takes the currency format**

DashboardValueFormat is now a union of DashboardCurrencyFormat and DashboardRelativeTimeFormat. Stat panels take both, chart panels only the currency one, and boot rejects relativeTime on a chart.

**Migration:** A chart panel that declares valueFormat keeps working with { kind: "currency", currency }. Code that types a chart's valueFormat as DashboardValueFormat should use DashboardCurrencyFormat instead; relativeTime on a chart was never meaningful and now fails boot.

## 0.373.0

### framework-core

**rateLimit accepts a list of buckets that are enforced all-or-nothing**

RateLimitDeclaration is now a single option, a non-empty list of options or the disabled form. RateLimitResolver gains the required method enforceAll(requests: readonly RateLimitBucketRequest[]); createRateLimitResolver and createUnlimitedRateLimitResolver implement it. Payload buckets in additionalRateLimits are charged through the same call.

**Migration:** Custom RateLimitResolver implementations and test fakes need an enforceAll method (check every bucket, then deduct from all or none, and throw RateLimitError for the rejected bucket with the largest retryAfter). Existing rateLimit declarations stay valid. A duplicate payloadField in additionalRateLimits is now a boot error; merge the entries into one.

## 0.372.0

### delivery

**Queued delivery jobs carry the recipient address sealed**

createDeliveryService takes an addressCipher; the boot wiring passes the master-key cipher, so delivery.render and delivery.send payloads hold sealedAddress instead of address. Workers open it through ctx.configEncryption.

**Migration:** Roll out worker and web together with the same KUMIKO_SECRETS_MASTER_KEY_V<n>; a worker without the master key fails sealed jobs with send_failed. Code that calls createDeliveryService itself passes addressCipher to get sealed payloads.

### files

**Orphaned upload bytes are swept through a new upload ledger**

The files feature registers the store_file_upload_ledger table and an hourly sweep job. FileContext has the new methods writeUploadBytes and forgetUploadBytes, which the four upload paths use; a custom FileContext or resolver must provide the ledger (withUploadLedger wraps a resolver). TenantDb.deleteMany resolves to the number of deleted rows instead of void. A fileRef commit whose ledger row was already swept throws InternalError "upload expired".

**Migration:** Generate and apply a migration with `kumiko-schema generate` — uploads fail without the new store_file_upload_ledger table

### framework-core

**executor.detail() and executor.list() return EntityRow<E>, derived from the entity definition**

Rows of createEntityExecutor / createEventStoreExecutor are typed per entity; wide entities keep Record<string, unknown>. createBooleanField is typed non-null. UserMfaRow in the bundled auth-mfa feature now declares enabledAt and lastUsedAt as Temporal.Instant, which is what the row always held.

**Migration:** Remove the `row as T` casts on executor.detail() / executor.list() results with `bun kumiko-upgrade --apply` (codemod remove-engine-payload-casts). Casts to a type the row does not satisfy stay and are listed as manual; replace them with a field-level check or a narrower type.

**Tokens carrying system or all lose those roles on verify**

jwt.verify strips the system and all roles that session minting never grants, so a self-signed or leaked-key token cannot act as System.

**Migration:** Apps that mint their own tokens with the `system` role must stop doing so and use `createSystemUser` or system dispatch in-process instead. Tokens issued by the framework are unaffected. Tests that send a system user over `stack.http.*` must switch to `stack.dispatcher.write/query`.

**http.route and the metric route label carry the route pattern, http.target is removed**

Spans are named "METHOD pattern" instead of "http.request"; paths no route matched are labelled "unmatched". The PII ciphertext guard message names the pattern as well.

**Migration:** Dashboards, alerts and trace queries keyed on raw paths or on the span name "http.request" must switch to route patterns and the "METHOD pattern" span name. Read the query string from your access logs if you relied on http.target.

## 0.370.0

### @cosmicdrift/kumiko-server-runtime

**runProdApp requires envSchema**

envSchema on runProdApp is no longer optional. Without it the boot throws a KumikoBootError that points to composeEnvSchema. An app without its own variables passes composeEnvSchema({ core: frameworkCoreEnvSchema, features }).

**Migration:** Pass envSchema: composeEnvSchema({ core: frameworkCoreEnvSchema, features }) to runProdApp, with composeEnvSchema from @cosmicdrift/kumiko-framework/env and frameworkCoreEnvSchema from @cosmicdrift/kumiko-dev-server/env-schema. App-level variables go into extend. Delete hand-written env checks that ran before runProdApp; the schema covers them.

### @cosmicdrift/kumiko-types

**SaveContext.event and DeleteContext.event are required**

postSave and postDelete hooks always receive the stored event, so event is no longer optional on SaveContext and DeleteContext. Hooks read the caller from event.createdBy instead of guarding for undefined.

**Migration:** Code that builds a SaveContext or DeleteContext by hand, usually in tests, sets event, for example with createTestStoredEvent() from @cosmicdrift/kumiko-testing/helpers. Drop optional chaining on ctx.event in hooks.

### auth-foundation

**The deprecated authFoundationFeature constant is removed**

authFoundationFeature was kept next to createAuthFoundationFeature() for one release. Mount the feature by calling createAuthFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces authFoundationFeature with createAuthFoundationFeature().

### auth-mfa-user-data

**The deprecated authMfaUserDataFeature constant is removed**

authMfaUserDataFeature was kept next to createAuthMfaUserDataFeature() for one release. Mount the feature by calling createAuthMfaUserDataFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces authMfaUserDataFeature with createAuthMfaUserDataFeature().

### billing-foundation

**The deprecated billingFoundationFeature constant is removed**

billingFoundationFeature was kept next to createBillingFoundationFeature() for one release. Mount the feature by calling createBillingFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces billingFoundationFeature with createBillingFoundationFeature().

### cap-counter

**The deprecated capCounterFeature constant is removed**

capCounterFeature was kept next to createCapCounterFeature() for one release. Mount the feature by calling createCapCounterFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces capCounterFeature with createCapCounterFeature().

### compliance-profiles-ops

**The deprecated complianceProfilesOpsFeature constant is removed**

complianceProfilesOpsFeature was kept next to createComplianceProfilesOpsFeature() for one release. Mount the feature by calling createComplianceProfilesOpsFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces complianceProfilesOpsFeature with createComplianceProfilesOpsFeature().

### custom-fields

**The deprecated customFieldsFeature constant is removed**

customFieldsFeature was kept next to createCustomFieldsFeature() for one release. Mount the feature by calling createCustomFieldsFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces customFieldsFeature with createCustomFieldsFeature().

### derivatives-sharp

**The deprecated derivativesSharpFeature constant is removed**

derivativesSharpFeature was kept next to createDerivativesSharpFeature() for one release. Mount the feature by calling createDerivativesSharpFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces derivativesSharpFeature with createDerivativesSharpFeature().

### document-ingest-foundation

**The deprecated documentIngestFoundationFeature constant is removed**

documentIngestFoundationFeature was kept next to createDocumentIngestFoundationFeature() for one release. Mount the feature by calling createDocumentIngestFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces documentIngestFoundationFeature with createDocumentIngestFoundationFeature().

### file-derivatives

**The deprecated fileDerivativesFeature constant is removed**

fileDerivativesFeature was kept next to createFileDerivativesFeature() for one release. Mount the feature by calling createFileDerivativesFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces fileDerivativesFeature with createFileDerivativesFeature().

### file-foundation

**The deprecated fileFoundationFeature constant is removed**

fileFoundationFeature was kept next to createFileFoundationFeature() for one release. Mount the feature by calling createFileFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces fileFoundationFeature with createFileFoundationFeature().

### file-provider-inmemory

**The deprecated fileProviderInMemoryFeature constant is removed**

fileProviderInMemoryFeature was kept next to createFileProviderInMemoryFeature() for one release. Mount the feature by calling createFileProviderInMemoryFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces fileProviderInMemoryFeature with createFileProviderInMemoryFeature().

### file-provider-s3

**The file-provider-s3-env and files-provider-s3 subpaths are removed**

Both deprecated re-export subpaths of the S3 merge are gone. The env-driven provider is createFileProviderS3Feature({ fromEnv: true }) from @cosmicdrift/kumiko-bundled-features/file-provider-s3 and replaces fileProviderS3EnvFeature. S3ProviderConfig, createS3Provider, createS3ProviderFromEnv, parseS3EnvConfig and resolveForcePathStyle come from @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib.

**Migration:** Run bun kumiko-upgrade --apply. It rewrites fileProviderS3EnvFeature to createFileProviderS3Feature({ fromEnv: true }) and moves files-provider-s3 imports to file-provider-s3/lib.

**The deprecated fileProviderS3Feature constant is removed**

fileProviderS3Feature was kept next to createFileProviderS3Feature() for one release. Mount the feature by calling createFileProviderS3Feature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces fileProviderS3Feature with createFileProviderS3Feature().

### folders

**The deprecated foldersFeature constant is removed**

foldersFeature was kept next to createFoldersFeature() for one release. Mount the feature by calling createFoldersFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces foldersFeature with createFoldersFeature().

### folders-user-data

**The deprecated foldersUserDataFeature constant is removed**

foldersUserDataFeature was kept next to createFoldersUserDataFeature() for one release. Mount the feature by calling createFoldersUserDataFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces foldersUserDataFeature with createFoldersUserDataFeature().

### form-draft

**The deprecated formDraftFeature constant is removed**

formDraftFeature was kept next to createFormDraftFeature() for one release. Mount the feature by calling createFormDraftFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces formDraftFeature with createFormDraftFeature().

### form-draft-user-data

**The deprecated formDraftUserDataFeature constant is removed**

formDraftUserDataFeature was kept next to createFormDraftUserDataFeature() for one release. Mount the feature by calling createFormDraftUserDataFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces formDraftUserDataFeature with createFormDraftUserDataFeature().

### framework-core

**import-extensions codemod and tsconfig options for .ts import specifiers**

The import-extensions codemod rewrites relative import and export specifiers that end in .js or .jsx to the .ts or .tsx file next to the importer (import, export from, import type, import() and mock.module). It leaves a specifier alone and reports it when no such file exists. The framework repo itself now imports with .ts endings; its published dist is unchanged. tsc writes .js into the dist, and the .d.ts files keep .ts specifiers, which TypeScript resolves to the sibling .d.ts. An app tsconfig needs allowImportingTsExtensions: true, because the framework packages now ship sources with .ts specifiers and tsc checks them (the preset @cosmicdrift/kumiko-framework/tsconfig.app.json sets it). A tsconfig that emits JS also needs rewriteRelativeImportExtensions (TypeScript 5.7 or newer); a project that only type-checks code from another project reference needs rewriteRelativeImportExtensions false plus emitDeclarationOnly. Consumer code with .js endings keeps running once the option is set.

**Migration:** Add `allowImportingTsExtensions: true` to the app tsconfig (or extend @cosmicdrift/kumiko-framework/tsconfig.app.json), then run the codemod (bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/import-extensions.ts . --write); the guard import-extensions reports remaining .js specifiers.

**createDbConnection takes only the options object, the bun-db subpath is gone**

The positional createDbConnection(url, options) overload and the deprecated @cosmicdrift/kumiko-framework/bun-db subpath are removed. createDbConnection({ url, ...options }) and the query helpers come from @cosmicdrift/kumiko-framework/db. Removed from /bun-db: DeleteManyBatchedOptions, DeleteManyBatchedResult, IncrementCounterOptions, InnerJoinRow, InnerJoinSpec, InsertOnConflictDoNothingOptions, JoinColumnPair, JsonTextMatch, SelectOptions, TableInfo, UpsertOnConflictOptions, WhereObject, WhereOperator, WhereValue, aggregateWhere, asEntityTableMeta, asRawClient, countWhere, deleteMany, deleteManyBatched, extractTableInfo, fetchOne, incrementCounter, insertMany, insertOnConflictDoNothing, insertOne, instantToTimestamptzParam, isTimestamptzType, requireEntityTableMeta, runInSavepoint, runInSavepointIfSupported, runnerCanBeginTransaction, selectInnerJoin, selectMany, transaction, unsafeReadRetrying, updateMany, upsertByPk, upsertOnConflict.

**Migration:** Run bun kumiko-upgrade --apply. It rewrites positional calls to createDbConnection({ url, ... }) and moves bun-db imports to @cosmicdrift/kumiko-framework/db.

**DB_PROVIDER other than postgres fails at boot**

dbConnectionOptionsFromEnv used to ignore DB_PROVIDER, so DB_PROVIDER=bun booted postgres-js while the deployment still claimed Bun.SQL. Any value other than empty or "postgres" now throws with a hint to remove the variable.

**Migration:** Remove DB_PROVIDER from the environment, Helm values and Pulumi config. postgres-js is the only driver.

**createTenantDb takes only the options object**

The positional createTenantDb(db, tenantId, ...) overload is removed. createTenantDb({ db, tenantId, ... }) is the only form.

**Migration:** Run bun kumiko-upgrade --apply. It rewrites positional calls to createTenantDb({ db, tenantId, ... }).

**The test stack is no longer re-exported from the framework**

The subpaths @cosmicdrift/kumiko-framework/stack, /testing, /testing/handler-context, /testing/real-providers and /testing/e2e-generator are removed, and so is the optional peer dependency on @cosmicdrift/kumiko-testing. The test stack and helpers live only in @cosmicdrift/kumiko-testing. Removed from /stack: CreateTestDbOptions, EventCollector, RequestHelper, TestDb, TestRedis, TestStack, TestStackOptions, TestUsers, createEventCollector, createRequestHelper, createTestDb, createTestRedis, createTestUser, drainEventConsumers, pushEntityProjectionTables, resetEventStore, setupTestStack, testTenantId, testUserId, unsafeCreateEntityTable, unsafeEnsureEntityTable, unsafePushTables. Removed from /testing and its subpaths: ClearableTable, E2EGeneratorOptions, E2ETestSpec, EditFillOp, LateBoundHolder, ManualClock, MutableMasterKeyProvider, ParsedSetCookie, REAL_PROVIDERS_ENV, RecordingProvider, bridgeStub, buildMultipartBody, captureClosedConnectionError, clearTables, createLateBoundHolder, createManualClock, createMutableMasterKeyProvider, createRecordingProvider, createTestEnvelopeCipher, createTestMasterKeyProvider, deleteRows, describeFileProviderContract, expectError, expectErrorIncludes, expectSuccess, generateE2ESpec, generateZodFixture, getSetCookieRaw, getSetCookieValue, getSetCookies, isRealProviderRun, patchFileInstanceofForBunTest, requireRealProviders, resetBlindIndexKeyForTests, resetEntityFieldEncryptionCacheForTests, resetEventPiiCatalogForTests, resetPiiSubjectKmsForTests, resetTestTables, rolesOf, seedRow, seedRows, sharedItemEntity, sharedItemTable, sharedUserEntity, sharedUserTable, sharedWidgetEntity, sharedWidgetTable, sleep, updateRows, waitFor, withBootValidatorFixture, withoutAmbientTemporal, zipWithEntries.

**Migration:** Run bun kumiko-upgrade --apply. It moves the imports to the matching @cosmicdrift/kumiko-testing subpaths. Add @cosmicdrift/kumiko-testing to devDependencies if it is not there yet.

**escapeHatch on a spread entity query handler requires SystemAdmin access**

A query handler that spreads defineEntityListHandler or defineEntityDetailHandler and adds escapeHatch afterwards skipped the SystemAdmin-only access check that the factory option enforces. Registration now applies the same check and throws for any other access.

**Migration:** Pass escapeHatch as an option of defineEntityListHandler or defineEntityDetailHandler with access { roles: access.systemAdmin }, or write a plain r.queryHandler that does not reuse the entity convention handler when a tenant-scoped query needs a raw lookup.

### inbound-mail-foundation

**The deprecated inboundMailFoundationFeature constant is removed**

inboundMailFoundationFeature was kept next to createInboundMailFoundationFeature() for one release. Mount the feature by calling createInboundMailFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces inboundMailFoundationFeature with createInboundMailFoundationFeature().

### inbound-provider-imap

**The deprecated inboundProviderImapFeature constant is removed**

inboundProviderImapFeature was kept next to createInboundProviderImapFeature() for one release. Mount the feature by calling createInboundProviderImapFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces inboundProviderImapFeature with createInboundProviderImapFeature().

### inbound-provider-inmemory

**The deprecated inboundProviderInMemoryFeature constant is removed**

inboundProviderInMemoryFeature was kept next to createInboundProviderInMemoryFeature() for one release. Mount the feature by calling createInboundProviderInMemoryFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces inboundProviderInMemoryFeature with createInboundProviderInMemoryFeature().

### ledger

**The deprecated ledgerFeature constant is removed**

ledgerFeature was kept next to createLedgerFeature() for one release. Mount the feature by calling createLedgerFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces ledgerFeature with createLedgerFeature().

### mail-foundation

**The deprecated mailFoundationFeature constant is removed**

mailFoundationFeature was kept next to createMailFoundationFeature() for one release. Mount the feature by calling createMailFoundationFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces mailFoundationFeature with createMailFoundationFeature().

### mail-transport-inmemory

**The deprecated mailTransportInMemoryFeature constant is removed**

mailTransportInMemoryFeature was kept next to createMailTransportInMemoryFeature() for one release. Mount the feature by calling createMailTransportInMemoryFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces mailTransportInMemoryFeature with createMailTransportInMemoryFeature().

### mail-transport-smtp

**The deprecated mailTransportSmtpFeature constant is removed**

mailTransportSmtpFeature was kept next to createMailTransportSmtpFeature() for one release. Mount the feature by calling createMailTransportSmtpFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces mailTransportSmtpFeature with createMailTransportSmtpFeature().

### notes-history

**The deprecated notesHistoryFeature constant is removed**

notesHistoryFeature was kept next to createNotesHistoryFeature() for one release. Mount the feature by calling createNotesHistoryFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces notesHistoryFeature with createNotesHistoryFeature().

### notes-history-user-data

**The deprecated notesHistoryUserDataFeature constant is removed**

notesHistoryUserDataFeature was kept next to createNotesHistoryUserDataFeature() for one release. Mount the feature by calling createNotesHistoryUserDataFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces notesHistoryUserDataFeature with createNotesHistoryUserDataFeature().

### readiness

**The deprecated readinessFeature constant is removed**

readinessFeature was kept next to createReadinessFeature() for one release. Mount the feature by calling createReadinessFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces readinessFeature with createReadinessFeature().

### tags

**The deprecated tagsFeature constant is removed**

tagsFeature was kept next to createTagsFeature() for one release. Mount the feature by calling createTagsFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces tagsFeature with createTagsFeature().

### template-resolver-user-data

**The deprecated templateResolverUserDataFeature constant is removed**

templateResolverUserDataFeature was kept next to createTemplateResolverUserDataFeature() for one release. Mount the feature by calling createTemplateResolverUserDataFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces templateResolverUserDataFeature with createTemplateResolverUserDataFeature().

### tenant-settings

**The deprecated tenantSettingsFeature constant is removed**

tenantSettingsFeature was kept next to createTenantSettingsFeature() for one release. Mount the feature by calling createTenantSettingsFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces tenantSettingsFeature with createTenantSettingsFeature().

### tier-engine

**The deprecated tierEngineFeature constant is removed**

tierEngineFeature was kept next to createTierEngineFeature() for one release. Mount the feature by calling createTierEngineFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces tierEngineFeature with createTierEngineFeature().

### waitlist

**Waitlist gets linkOnSignup, a configurable submit rate limit, export and purge handlers and a status provisioned**

createWaitlistFeature({ linkOnSignup: true }) marks an invited entry provisioned, with linkedTenantId and provisionedAt, when its email becomes the first TenantAdmin member of a tenant; a multi-stream consumer on the membership event does this asynchronously. rateLimit replaces the default of 5 submits per IP per 10 minutes, or { disabled: true, reason } turns it off. waitlist:write:export and waitlist:write:purge are SystemAdmin-only (exportPurge: false leaves them out); purge needs confirmCount to match the current number of entries and shreds the personal-data keys only after every entry was forgotten. The entity gains the status provisioned and the column provisionedAt, so apps that mount the feature generate a schema migration. kumiko ops waitlist-migrate --from offlot|publicstatus [--dry-run] copies a legacy waitlist table into the entity idempotently. Details in docs/guides/waitlist.md.

**Migration:** Apps that mount the waitlist feature run `kumiko schema generate <name>` and commit the migration: read_waitlist_entries gains the nullable column provisioned_at, and the status value provisioned is added. An app with its own waitlist (offlot-app, publicstatus, solon) mounts createWaitlistFeature() and copies the old rows with `kumiko ops waitlist-migrate --from offlot|publicstatus --dry-run` first. offlot-app keeps its legacy rows in the table read_waitlist_entries, the name the framework projection uses: copy or rename that table before the first boot and pass --source-table. The submit limit is keyed per IP and handler; behind a reverse proxy set trustedProxyHops, otherwise all visitors share one bucket of 5 submits per 10 minutes. With linkOnSignup the new consumer starts at the beginning of the event log and also provisions entries invited earlier.

### workflow-runner

**The deprecated workflowRunnerFeature constant is removed**

workflowRunnerFeature was kept next to createWorkflowRunnerFeature() for one release. Mount the feature by calling createWorkflowRunnerFeature().

**Migration:** Run bun kumiko-upgrade --apply. It replaces workflowRunnerFeature with createWorkflowRunnerFeature().

## 0.369.0

### channel-email

**The tenant mail transport applies per notification**

r.notification(name, { tenantTransport: true }) marks a notification whose mails go through the tenant's own mail transport. channel-email consults its tenantTransport resolver only for these (also under a renamedFrom name); every other notification, such as password reset or sign-in mails, always takes the app transport, even when the tenant has a provider. With tenantTransport set, transport may be omitted: a mail that then has no transport fails with missing_credentials instead of throwing. The template test mail (template-resolver send-test) now gets the tenant config in its channel context and uses the template's notification, so it leaves through the same transport as the real mail.

**Migration:** Apps that pass tenantTransport to createChannelEmailFeature add `tenantTransport: true` to every r.notification whose mails should go through the tenant's provider; without the flag those mails now go through the app transport. Apps without an app SMTP server can drop transport and keep tenantTransport.

### mail-transport-smtp

**Tenant admins edit their own SMTP server on the Email sending screen**

mail-foundation's provider key and the SMTP keys (host, port, SSL/TLS, user name, sender address) carry settings masks, so the generated Settings-Hub shows tenant admins one Email sending form: the provider choice, the chosen provider's connection fields and its password, each field with a help text and every label in English, German and Spanish, saved together by one Save button in one /api/batch. Switching the provider swaps the fields at once; fields of a provider that is not selected are not saved. A selector owner's selection screen (`<owner>-tenant-selection`) now carries the plugins' config keys (field id `<owner>-<key>`) and secrets (field id `<plugin>-<key>`, listed in the new ConfigEditScreenDefinition.secretKeys) behind a visible condition on the provider field; the separate `<plugin>-tenant` and `<plugin>-tenant-secrets` screens and their dashboard panels are gone, and so is the `config.settings.saveProvider` label. A secret with its own writeRoles stays on the global secrets screen. Boot validation checks every secretKeys field (tenant scope, writeOnly text, declared secret). The configEdit renderer loads secretKeys fields from secrets:query:list (set or unset, no preview), writes them with secrets:write:set or secrets:write:delete in the same batch, and leaves hidden fields out. The provider key is no longer required: empty means the tenant has no own server and the platform sends, so readiness no longer reports it as missing (createTransportForTenant still throws on an empty provider). The provider and SMTP keys are written by TenantAdmin and the system identity, no longer by SystemAdmin, because a platform-level provider would reach every tenant without that tenant's password. The secrets set and delete handlers also admit the system identity, so server code stores a tenant secret via dispatchSystemWrite through the same key and value checks as an admin; the settings screens keep showing only the human roles. The provider choice shows each plugin's `<feature>.settings` name, also for a plugin without settings of its own, and keeps the English name when a locale feature mounted earlier declares the same key in its own language only. A MailTransportPlugin with `selectableInSettings: false` stays allowed on the server but is not offered in the form; the in-memory transport sets it, because apps mount it next to smtp in production and a tenant admin picking it would drop every mail. A plugin's secrets section takes an optional `<feature>.settings.secrets` title (SMTP password under "SMTP sign-in").

**Migration:** E2E specs that used the testIds `dashboard-panel-<plugin>-tenant`, `dashboard-panel-<plugin>-tenant-secrets` or the separate secret input of these screens address the fields of `<owner>-tenant-selection` instead (one Save). Code that wrote these keys as a SystemAdmin user writes them as the tenant's TenantAdmin or via dispatchSystemWrite. Apps that relied on readiness flagging an empty provider check it themselves.

## 0.368.0

### @cosmicdrift/kumiko-dev-server

**@app/define and kumiko codegen are removed**

The .kumiko/ codegen (define.ts, types.generated.d.ts, schemas.generated.ts) is gone: runCodegen, scanEvents and their types are no longer exported, the dev server no longer watches r.defineEvent calls, `kumiko codegen` is removed, `kumiko-build --check` is removed and kumiko-build no longer runs a codegen pass. The scaffolded .gitignore no longer lists .kumiko/, so the upgrade marker .kumiko/upgrade-state.json can be committed. ctx.appendEvent stays bound to the augmentable KumikoEventTypeMap; to emit an event with a payload checked against its definition use emitEvent(ctx, eventDef, { aggregateId, aggregateType, payload, headers? }) with the EventDef that r.defineEvent returns (emitEvent now also accepts headers).

**Migration:** Replace `@app/define` imports with direct framework imports (defineWriteHandler/defineQueryHandler/defineFeature from @cosmicdrift/kumiko-framework/engine, events via r.defineEvent and emitEvent) and drop the `file:./.kumiko` dependency plus the bunfig/tsconfig resolver entries. Known sites: publicstatus 43 files, kumiko-platform 13 (samples), solon 3, money-horse 1, phronexsis 1.

### file-provider-s3

**The S3 file providers merge into createFileProviderS3Feature({ fromEnv })**

createFileProviderS3Feature() mounts the per-tenant config provider as before. createFileProviderS3Feature({ fromEnv: true }) mounts the env-configured provider (feature name, provider key "s3-env" and requires unchanged). The S3 client helpers (createS3Provider, createS3ProviderFromEnv, parseS3EnvConfig, resolveForcePathStyle, S3ProviderConfig) move to the new subpath @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib.

The subpaths file-provider-s3-env and files-provider-s3 keep working as deprecated re-exports and are removed in the first release after 2026-10-29.

old -> new:
  fileProviderS3EnvFeature from .../file-provider-s3-env -> createFileProviderS3Feature({ fromEnv: true }) from .../file-provider-s3
  fileProviderS3Feature -> createFileProviderS3Feature()
  @cosmicdrift/kumiko-bundled-features/files-provider-s3 -> @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib

**Migration:** Run `bun kumiko-upgrade --apply`. It rewrites the imports and the env feature mount, and reports `typeof fileProviderS3EnvFeature` and re-exports of it with file and line.

### framework-core

**createDbConnection({ url, ... }) is the only connection factory, query helpers move from /bun-db to /db**

postgres-js is the only DB driver. createDbConnection takes one options object, is synchronous and accepts the new options ssl and onNotice. The Bun.SQL provider, createConnection, createPgConnection and DB_PROVIDER are removed. The query helpers (selectMany, insertOne, transaction, asRawClient, ...) keep their API and are now exported from @cosmicdrift/kumiko-framework/db. The `tx` handed to the transaction() callback is typed as DbTx (the postgres-js transaction handle it always was at runtime) instead of the Bun.SQL instance type; a helper that takes `db: DbConnection` and receives that tx needs `DbRunner` or `DbTx`.

The positional form createDbConnection(url, options) and the @cosmicdrift/kumiko-framework/bun-db subpath keep working as deprecated aliases and are removed in the first release after 2026-10-29.

old -> new:
  createConnection(url, options) (async) -> createDbConnection({ url, ...options }) (sync)
  createPgConnection(url, options) -> createDbConnection({ url, ...options })
  createDbConnection(url, options) -> createDbConnection({ url, ...options }) (positional form is deprecated)
  @cosmicdrift/kumiko-framework/bun-db -> @cosmicdrift/kumiko-framework/db (deprecated alias until the first release after 2026-10-29)

Removed without replacement: createBunDbConnection, bunDbConnectionOptionsFromEnv, the BunDbConnection, BunDbTx, BunDbRunner and BunDbConnectionOptions types, DbPoolHandle (use DbConnectionHandle), the PgListenClient re-export from /bun-db (import it from @cosmicdrift/kumiko-types/db-connection) and the DB_PROVIDER environment variable.

**Migration:** Run `bun kumiko-upgrade --apply`. It rewrites bun-db imports to /db, createDbConnection(url, options) and createConnection/createPgConnection calls to the object form, and reports leftovers (removed Bun.SQL exports, DB_PROVIDER) with file and line. Remove DB_PROVIDER from your env files.

**Bundled feature constants become create*Feature() factories**

Every bundled feature that was mounted as a constant (tagsFeature, ledgerFeature, authFoundationFeature, ...) now has a create<Name>Feature() factory exported from the same subpath, and apps mount `createTagsFeature()` instead of `tagsFeature`. Factories of features without options take no arguments; the ones that already had options keep them. Two calls of a factory give interchangeable instances, so mounting the same feature from two stacks does not trip the "mounted twice as distinct instances" check.

The old constants keep working as deprecated aliases and are removed in the first release after 2026-10-29.

old -> new:
  tagsFeature -> createTagsFeature()
  ledgerFeature -> createLedgerFeature()
  authFoundationFeature -> createAuthFoundationFeature()
  fooBarFeature -> createFooBarFeature() (same rule for every bundled feature constant)
  typeof tagsFeature -> ReturnType<typeof createTagsFeature>

**Migration:** Run `bun kumiko-upgrade --apply`. It renames the imports and replaces every use with the factory call. It reports aliased imports, re-exports, namespace access, dynamic imports and files that compare a feature by identity with file and line; handle those by hand (one factory call per mount, or keep one shared instance).

**createTenantDb({ db, tenantId, ... }) takes one options object**

createTenantDb takes one CreateTenantDbOptions object ({ db, tenantId, mode?, tracer?, meter?, signal?, grants? }); mode still defaults to "tenant". The positional form createTenantDb(db, tenantId, mode, tracer, meter, signal, grants) keeps working as a deprecated overload and is removed in the first release after 2026-10-29.

old -> new:
  createTenantDb(db, tenantId) -> createTenantDb({ db, tenantId })
  createTenantDb(db, tenantId, "system", tracer, meter, signal, grants) -> createTenantDb({ db, tenantId, mode: "system", tracer, meter, signal, grants })

**Migration:** Run `bun kumiko-upgrade --apply`. It rewrites positional calls (literal undefined arguments are dropped) and reports spread arguments, calls with more than seven arguments and uses of createTenantDb as a value (callback, .bind/.call/.apply) with file and line.

**HandlerContext and AppContext no longer expose _userId and _handlerType**

The dispatcher no longer sets _userId and _handlerType on the context of write handlers, query handlers and hooks. The caller identity is ctx.user.id in handlers and result.event.createdBy in postSave and postDelete hooks. requireSecretsContext reads ctx._userId first and falls back to ctx.user.id, so passing a handler context to it keeps the same audit identity. Provider contexts (FileProviderContext, MailTransportContext, InboundMailContext) keep their own _userId. JobContext._userId is unchanged.

**Migration:** Replace ctx._userId with ctx.user.id in write and query handlers. postSave and postDelete hooks get an AppContext without user; read the caller there from result.event.createdBy. Known sites: one file each in money-horse, offlot-app, phronexsis and kumiko-enterprise. _handlerType had no readers.

## 0.367.0

### @cosmicdrift/kumiko-renderer-mail-html

**Mail footer texts come from the i18n system**

The "Sent by" line of the default mail layout, the unsubscribe label and the imprint and privacy labels now come from the mail translations (mail.footer.sentBy, mail.footer.unsubscribe, mail.footer.imprint, mail.footer.privacy). English ships with the renderer, German and Spanish with locale-de and locale-es; an unknown locale falls back to its root language and then to English. MailFooterLink.label is optional and defaults to the framework text. The default layout renders the sender line through the new mailSentBy placeholder. MAIL_CHROME_EN exports the English source texts for translation tooling.

**Migration:** Apps that send German or Spanish mails mount localeDe() or localeEs(), otherwise the footer labels are English. A mail layout already stored from the old default keeps its fixed "Sent by" text until it is reseeded or edited.

## 0.366.0

### framework-core

**One injectable Clock for ctx.tz in handlers and jobs**

New type Clock and TzContextOptions.clock. AppContext.clock feeds ctx.tz.now() in handlers, and JobContext.tz gives jobs the same ctx.tz API (tenant timezone from tenant config, read once per job run, UTC fallback). The testing helper createManualClock(start) returns a clock with set and advance. The tenant-lifecycle job now reads time through ctx.tz.now().

**Migration:** Code that builds a JobContext literal itself (boot seeds, test doubles) adds `tz: createTzContext()`.

**Registrar methods take a single object, positional calls throw at registration**

r.writeHandler, r.queryHandler, r.entity, r.requires and r.hook now take one object. The positional overloads are gone from the types and throw when the feature is defined, with a message that points at the codemod. The throw is removed in the first release after 2026-10-29.

writeHandler (queryHandler is the same shape):
  before: r.writeHandler("order:archive", schema, handler, { access });
  after:  r.writeHandler({ name: "order:archive", schema, handler, access });

hook (type picks the handler shape, target is a name, a list or { allOf }):
  before: r.hook("postSave", "order", handler, { escapeHatch });
  after:  r.hook({ type: "postSave", target: "order", handler, escapeHatch });

entity and requires:
  before: r.entity("order", definition, { table: ordersTable });  r.requires("auth", "tenant");
  after:  r.entity({ name: "order", ...definition, backingTable: ordersTable });  r.requires({ features: ["auth", "tenant"] });

registerEntityCrud is no longer exported from @cosmicdrift/kumiko-framework/engine; call r.crud(name, entity, options) instead. The entity option { table } is now backingTable on the r.entity object and lands in the feature's entityTables, not in its entities. HookDefinition and EntityObjectDefinition are exported from @cosmicdrift/kumiko-types. Hook definitions are checked per type: validation takes no escapeHatch, phase only exists on postSave and postDelete, and { allOf } is not accepted on preSave.

**Migration:** Run `bun kumiko-upgrade --apply`. It rewrites every positional r.writeHandler, r.queryHandler, r.entity, r.requires, r.hook and registerEntityCrud call to the object form. Calls it cannot resolve statically (a spread argument, a registrar that is not typed as FeatureRegistrar) are listed as manual work with file and line; rewrite those by hand.

### inbound-mail-foundation

**InboundMailContext exposes metricsFor to provider plugins**

InboundMailContext gains an optional metricsFor(featureName) returning a MetricsHandle. runProdApp, the worker app and the dev server wire it from the observability meter, so provider plugins can emit their own metrics through the same pipeline.

**Migration:** Code that builds SystemWireDeps itself adds metricsFor (createMetricsForFactory(meter)).

## 0.365.0

### @cosmicdrift/kumiko-dev-server

**The kumiko-schema-check bin and the resolveGeneratePath, usesDerivedSchemaLayout and implicitAuthModeFeatureNames exports are removed**

kumiko-schema-check diffed APP_FEATURES against a hand-kept FEATURE_IMPORT_REGISTRY. Apps with kumiko/schema.ts derive their entities from the mounted features and have no registry that could drift, so the check was a no-op there. The helpers resolveGeneratePath, usesDerivedSchemaLayout and implicitAuthModeFeatureNames are no longer exported from @cosmicdrift/kumiko-dev-server/cli.

**Migration:** Apps with kumiko/schema.ts need nothing. Run kumiko-schema validate to check migrations against the mounted features, and remove kumiko-schema-check from package scripts and CI. Apps that keep a FEATURE_IMPORT_REGISTRY diff it against APP_FEATURES in their own coverage script.

### @cosmicdrift/kumiko-renderer-puppeteer-client

**image-snapshot HTML must embed every resource as a data URI**

An earlier release note said image-snapshot requests were unchanged. Since the puppeteer-service egress guard, the service fetches no http(s) resources for any request kind, so external img, link and font references in an image-snapshot are dropped without an error.

**Migration:** Embed images, fonts and stylesheets in image-snapshot HTML as data: URIs before sending payload.content.

### cap-counter

**Handlers wrapped with withCapEnforcement or withRollingCapEnforcement are rejected when called through a nested ctx.write**

Since the wrappers reserve through reserveBeforeTransaction, the dispatcher rejects a nested ctx.write, ctx.writeAs or handler-to-handler call of such a handler with an internal error ("has a pre-transaction phase ... cannot run as a nested write") instead of running it. Before the reservation lifecycle change the wrapped handler ran normally when called nested.

**Migration:** Dispatch rolling- and calendar-capped handlers only as top-level commands (HTTP write or batch). A handler that calls one through ctx.write declares the cap on itself instead, or the call moves out of the handler into a client or job that dispatches a top-level command.

### framework-core

**Boot checks from the review round 1 release reject configurations that used to boot**

These checks shipped as fixes without migration notes. Each one throws for a configuration that was accepted before:
- a where-rule subquery on a table whose columns cannot be derived
- a drawer prefill that targets a sensitive field or a field the form does not render
- two secret fields with the same id
- access.personalData "public-intake" combined with rateLimit: { disabled: true }
- a recordOwned field on an entity with idType "serial"
- dedupeFeatures for same-named features with different registrations
The agent-tools manifest check in buildToolCatalog throws when the catalog is built for a request, not at boot.

**Migration:** Boot every app against the new version before rolling it out, and send one agent tool request if the app mounts agent-tools. Give where-rule subqueries a table with derivable columns, prefill only rendered non-sensitive fields, make secret field ids unique, give public-intake handlers a rateLimit that is not disabled, switch recordOwned entities to idType "uuid" or change the field's personal stance, and rename or align duplicated features.

**Boot rejects visibleWhen queries with required input, non-sql index where clauses, lockedWhen on read-restricted fields and same-named features with a different surface**

These checks used to be absent or silent and now stop the app at boot:
- A screen or dashboard panel visibleWhen that names a query whose input schema does not accept an empty payload. The client gate runs it with an empty payload, so the screen stayed hidden.
- An entity index where that is not a sql expression. It used to be dropped, which built a full (unique) index.
- A lockedWhen field that declares access.read.
- Two features with the same name whose screens, navs, jobs, events, translations, config keys, notifications, metrics or hooks differ. The second one used to be dropped.

**Migration:** Boot each app once against the new version. For a visibleWhen query, make its input fields optional or point visibleWhen at an input-free query. Write index where clauses with sql`...`. Remove access.read from the lockedWhen field or lock on a field every role can read. Give differing same-named features distinct names or make their surfaces identical.

**Entity list and detail handlers with escapeHatch must declare SystemAdmin-only access**

defineEntityListHandler, defineEntityDetailHandler and registerEntityCrud read options with escapeHatch now throw at definition unless access is { roles: ["SystemAdmin"] }, like write handlers already did. A cross-tenant read reachable by any tenant role leaked foreign rows.

**Migration:** Give every list/detail handler that declares escapeHatch access: { roles: ["SystemAdmin"] }, or drop the escapeHatch if the handler should stay tenant-scoped.

**moneyAmount returns ColumnBuilder<bigint> instead of ColumnBuilder<number>**

The column was always created with bigint mode, so the driver returned a bigint while the type said number. The type now matches the runtime value. Code that assigned the column value to a number or did number arithmetic on it no longer typechecks.

**Migration:** Treat values read from a moneyAmount column as bigint (for example compare with 0n, or convert explicitly with Number() where the amount is known to fit). No schema change.

### template-resolver

**copy-locale copies the system default's files in a beforeTransaction phase and can no longer run as a nested write**

When a tenant copies a locale from the system default, the image and attachment files are now read and written to the tenant's storage in a beforeTransaction phase. The transaction only creates the fileRef rows, and the uploaded binaries are released when it does not commit. Before, the storage I/O held the database transaction open.

**Migration:** Dispatch copy-locale as a top-level command, or from a perCommand handler via ctx.write. A handler that called it nested moves that call into a client or job, or becomes a perCommand handler.

**onEditorReady receives null when the editor is destroyed**

DocumentTiptapEditor and PlaceholderLineEditor call onEditorReady(null) on destroy, so a held handle no longer points at a destroyed editor. The callback type is (handle: DocumentEditorHandle | null) => void. The document designer drops the handle of an unmounted field, so placeholder insertion no longer targets a destroyed editor.

**Migration:** A custom onEditorReady callback must accept null and drop its stored handle when it receives it.

**resource-upload, import-bundle and import-bundle-system upload in a beforeTransaction phase and can no longer run as nested writes**

The three handlers now validate and upload their files before the write transaction opens and only create the fileRef and template rows inside it, so no database connection sits idle in a transaction during storage I/O. A rolled-back transaction releases the uploaded bytes. Because they now have a pre-transaction phase, the dispatcher rejects a nested ctx.write, ctx.writeAs or handler-to-handler call of them ("has a pre-transaction phase"). The exported storeTemplateResource is replaced by prepareTemplateResourceBeforeTransaction (beforeTransaction half) and storePreparedTemplateResource (in-transaction half).

**Migration:** Dispatch resource-upload, import-bundle and import-bundle-system as top-level commands, or from a perCommand handler via ctx.write. A handler that called them nested moves that call into a client or job, or becomes a perCommand handler. Code that called storeTemplateResource calls prepareTemplateResourceBeforeTransaction in a beforeTransaction phase and passes the result to storePreparedTemplateResource in the handler.

## 0.364.0

### @cosmicdrift/kumiko-renderer-puppeteer-client

**renderAndStorePdf is removed; render in beforeTransaction with renderPdfBeforeTransaction and store with storeRenderedPdf**

renderAndStorePdf called the print service inside the write transaction and held a pool connection for the whole render. renderPdfBeforeTransaction(ctx, { slug, locale, variables, attachTo? }) now renders and uploads the PDF before the transaction opens, and storeRenderedPdf(ctx, event.prepared) writes the fileRef and rendered-pdf rows inside it. RenderAndStorePdfArgs is renamed RenderPdfArgs.

**Migration:** Move the render into the handler's beforeTransaction phase and store in the handler: defineWriteHandler({ name, schema, access, beforeTransaction: (event, ctx) => renderPdfBeforeTransaction(ctx, { slug: "invoice", locale: "de", variables }), handler: (event, ctx) => storeRenderedPdf(ctx, event.prepared) }). The result of storeRenderedPdf has the same shape as the old renderAndStorePdf result (StoredRenderedPdf). Rename the RenderAndStorePdfArgs type to RenderPdfArgs. A handler with a beforeTransaction phase cannot be called through a nested ctx.write; call it as a top-level command.

### cap-counter

**CapExceededError carries resetAt and retryAfterSeconds, API sets Retry-After**

**Migration:** Periodic caps no longer need RateLimitError({ windowSeconds: 0, ... }). Where you catch CapExceededError from enforceCap and rethrow it as RateLimitError, drop the catch and let CapExceededError pass: the response stays 429 with a correct Retry-After, error.code becomes cap_exceeded instead of rate_limited, and error.details carries resetAt and retryAfterSeconds. Keep a feature-specific message with enforceCap({ ..., i18nKey }) and pass a period end other than the calendar month with periodEndIso (e.g. a budget's resetsAtIso). Clients matching on rate_limited for these caps must also accept cap_exceeded. Any KumikoError with retryAfterSeconds (including RateLimitError thrown in a handler) now gets a Retry-After header from /api/write, /api/batch and /api/query.

### framework-core

**Handler field references support business keys and array fields**

**Migration:** handlerFieldReference(schema, field) now returns { entity, by, multiple } instead of the entity string. Replace reference with reference.entity; skip or handle fields where by is set (value is a business key, not an id) or multiple is true (value is an array).

**Writes without an open transaction run as their own command; ctx.db writes there throw**

Write handlers accept transaction "perCommand". Such a handler runs without a transaction of its own, so every ctx.write and ctx.writeAs it issues runs as its own top-level command with its own transaction, gates and afterCommit hooks. A perCommand handler cannot run as a nested ctx.write, cannot be part of a multi-command batch (422 per_command_handler_in_batch) and cannot combine with beforeTransaction or reserveBeforeTransaction (boot error). ctx.write and ctx.writeAs from stream handlers and top-level query handlers now take the same route, so afterCommit hooks of the called write, which never fired before, fire now. ctx.db writes (entity executor, insertOne, updateMany, deleteMany, db.global() writes) and event appends (appendEvent, unsafeAppendEvent, tryAppendEvent, fetchForWriting, archiveStream, restoreStream, snapshotAggregate) throw in stream handlers, top-level query handlers, perCommand handlers and in beforeTransaction and reserveBeforeTransaction. ctx.dbOutsideTransaction and ctx.outsideTransaction stay available, and ctx.db.unsafeRaw stays open as the audited escape hatch.

**Migration:** Stream and query code that writes through ctx.db or an executor bound to ctx.db calls a write handler through ctx.write or ctx.writeAs instead, or writes deliberately through ctx.dbOutsideTransaction. Check code that relied on afterCommit hooks of a write called from a stream or query handler not firing. bookCapUsage from a stream or query handler needs outsideTransaction true or a command. runInOwnTransaction(ctx.db, ...) stays locked in these contexts; runInOwnTransaction(ctx.dbOutsideTransaction, ...) is the way to a deliberate own transaction. Measured consumers: one stream handler (AI agent turn: conversation, activity and tool-call records through an executor on ctx.db, plus cap booking) and one query handler (AI text run: cap booking on ctx.db, log via ctx.write). No other consumer app has stream or query writes. The beforeTransaction/reserveBeforeTransaction lock affects no released code.

### template-resolver

**DocumentRepeatRow is removed, use DocumentTableRow**

Removed the DocumentRepeatRow alias

**Migration:** Replace `DocumentRepeatRow` with `DocumentTableRow` (identical shape).

**A draft no longer replaces the active template**

Saving a draft (upsert-tenant default, copy-locale, import-bundle with status draft) over an active template stores it beside the active version in the new column draft instead of overwriting content, meta and status; resolveTemplate, resolveLayout, preview without content and sends keep using the active version. publish and publish-system promote an open draft (the publish gate checks the draft) and record activeVersion and activeSince; the new handlers discard-draft and discard-draft-system drop it and refuse with no_draft when none is open. find-by-id and layout-source return the working version (the open draft with status draft, else the stored one) plus active { version, since }, null when nothing is served. overview keeps status and version of the served version and adds draftVersion and activeSince. A draft over a row that is not active (new, draft or archived) behaves as before. A tenant never sees system draft content: find-by-id, layout-source, overview, copy-locale and diff-to-system apply a system draft only for a SystemAdmin and hide system rows that were never served; list leaves those rows out too. Version numbers shown for an active row are the served version (activeVersion): resolveTemplate / resolveLayout results, tenant-overrides rows and the override diff no longer show the save counter that drafts raise.

**Migration:** Run kumiko schema generate and apply the migration before deploying: it adds the nullable columns draft, active_version and active_since to read_template_resources. No rebuild needed.

## 0.363.0

### @cosmicdrift/kumiko-renderer-mail-html

**Documents format dates and numbers by the template locale, dates in the long style**

readDocumentFormat used the tenant setting tenant-settings:config:locale ahead of the template locale, so a German invoice of a tenant set to English printed "Oct 1, 2026" and "€780.00". Mails, mail previews and document PDFs now format by the locale of the template that is rendered; the tenant settings still supply the currency. The date helper prints the long style ("1. Oktober 2026", "October 1, 2026") instead of the medium style ("01.10.2026", "Oct 1, 2026").

**Migration:** Tests or snapshots that assert rendered dates change from "05.03.2026" to "5. März 2026" (de) and from "Mar 5, 2026" to "March 5, 2026" (en). A tenant that relied on tenant-settings:config:locale to change the number format of its documents now needs a template in that locale.

**renders kind mail from document templates, Markdown path removed**

The plugin serves kind mail. It resolves the template by slug (contentFormat html, meta.subject required), compiles the document body to Handlebars through template-resolver, renders it in an isolated Handlebars instance (helpers money, date and link, HTML escaping on) and places the result into the mail-layout named by meta.layoutSlug (default slug default, in-code DEFAULT_MAIL_LAYOUT_MJML as fallback). The layout only sees content, subject, previewText, tenantName, signature, imprint and unsubscribeUrl. The response carries subject and previewText; the subject has line breaks removed. Markdown rendering and the content/contentFormat payload are gone; DEFAULT_MAIL_LAYOUT_MJML uses tenantName instead of appName. seedSystemMailLayout writes kind mail-layout slug default through seedSystemTemplate and is idempotent. New dependency on @cosmicdrift/kumiko-headless.

**Migration:** Send kind mail requests with { slug, locale, variables } and move mail texts into kind mail templates (html body plus meta.subject), for example through r.notification({ template, meta }). Custom mail layouts become kind mail-layout, contentFormat mjml, slug default and use {{tenantName}} instead of {{appName}}; the body is inserted with {{{content}}}.

**Package moved to the framework under the @cosmicdrift scope**

Renamed from @cosmicdriftgamestudio/kumiko-renderer-mail-html (GitHub Packages, kumiko-enterprise) to @cosmicdrift/kumiko-renderer-mail-html on npmjs. The rename itself changes no API; the other 0.363.0 entries list the API changes of this release.

**Migration:** Replace @cosmicdriftgamestudio/kumiko-renderer-mail-html with @cosmicdrift/kumiko-renderer-mail-html in package.json and in every import; install from npmjs instead of GitHub Packages.

### @cosmicdrift/kumiko-renderer-puppeteer-client

**renders document-pdf from templates, adds renderAndStorePdf, the rendered-pdf entity and puppeteer-status**

The plugin resolves the document-pdf template and its pdf-layout (header, signature, footer), embeds every image as a data URI and sends finished HTML to the puppeteer-service. renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) stores the PDF as a file and a rendered-pdf record with the template and layout version. The puppeteer-status query reports whether the service answers; while it does not, rendering fails with PuppeteerUnavailableError (HTTP 503, puppeteer_unavailable). The feature adds the table rendered_pdfs.

**Migration:** Call renderAndStorePdf(ctx, { slug, locale, variables, attachTo? }) from a write handler; no escape hatch or rendererDb is needed because the tenant db also reads system templates and files. Apps that mount renderer-puppeteer-client need a schema migration for rendered_pdfs (`kumiko schema generate`). PUPPETEER_SERVICE_URL and PUPPETEER_AUTH_TOKEN stay as before. image-snapshot requests are unchanged.

**Package moved to the framework under the @cosmicdrift scope**

Renamed from @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client (GitHub Packages, kumiko-enterprise) to @cosmicdrift/kumiko-renderer-puppeteer-client on npmjs. The rename itself changes no API; the other 0.363.0 entries list the API changes of this release.

**Migration:** Replace @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client with @cosmicdrift/kumiko-renderer-puppeteer-client in package.json and in every import; install from npmjs instead of GitHub Packages.

### auth-email-password

**AuthMailContent is removed**

The sections-based content type only fed the retired renderer-simple. Auth mails are template notifications with variables, so nothing builds or consumes AuthMailContent anymore.

**Migration:** Drop AuthMailContent imports; the auth mail text lives in the seeded templates and is overridden per tenant in the template editor.

**Auth mails are notifications with seeded templates, render*Email is gone**

password-reset, account-unlock, email-verification, signup-activation and invite are declared as r.notification with a localized template and variables, seeded as system templates at boot and rendered by renderer-mail-html, so a tenant can override the text in the template editor. A locale without its own subject key falls back to en, because the renderer has no locale fallback. AuthMailNotificationTypes is exported for the qualified names.

**Migration:** The notification types are now `auth-email-password:notify:<name>` (before: the plain names). Update delivery preferences, preference rows and tests that reference the old names. renderResetPasswordEmail, renderUnlockAccountEmail, renderVerifyEmail, renderActivationEmail, renderInviteEmail, AuthMailSection, RenderTokenContentArgs and RenderInviteEmailArgs are removed; AuthMailContent stays. An app that mounts auth-email-password now needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html (composeRendererStack() from dev-server mounts all of them; with includeBundled, composeFeatures adds whichever is missing). Boot fails with a clear error otherwise, and apps without the template tables need a schema migration (`kumiko schema generate`). kumiko-schema-check counts the three as implicit features of every HAS_AUTH app, so its check fails until that migration exists. Tests that read the token from a mail use the text part (`mail.text`); the html part encodes `=` as `&#x3D;`.

### billing-foundation

**Contract confirmation and termination mails use template variables**

contract-confirmation, contract-termination-receipt and contract-termination-operator-notice are r.notification declarations with variables and localized templates (de, en). The notification types are qualified names now (billing-foundation:notify:<name>). The notify data is the template variable object (subject, details, contractLines, termsParagraphs, operatorEmail), not sections.

**Migration:** Update delivery preferences and tests that referenced the old type strings, and anything that listens to the notification data. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`).

### channel-email

**A notification without a mail template fails on the email channel**

The renderer option of createChannelEmailFeature is removed. A notification routed to the email channel without template + meta fails its delivery permanently with "has no mail template, declare template + meta on r.notification". r.notification declares no channels, so this is not checked at boot; an app's own mail tests over the inmemory transport catch it.

**Migration:** Drop the renderer option. Declare template + meta (or localizedTemplate) and variables on every r.notification that reaches the email channel, or accept that its email delivery fails. Run the app's notification tests after the bump: every email notification without a template now fails there.

### delivery

**NotificationRenderer and RendererInput removed, immediate notify renders with the tenant config**

The inline (immediate, job-less) delivery path now gets the tenant config accessor like the delivery.render job, so the mail layout shows the tenant name in both paths. DeliveryServiceOptions and CreateDeliveryTestContextOptions accept tenantConfigFor; runProdApp wires it from the boot config resolver. The types NotificationRenderer and RendererInput are removed from the delivery exports because the legacy renderer path is gone.

**Migration:** Drop NotificationRenderer and RendererInput imports; render mails with template + meta on r.notification (see renderer-foundation).

### framework-core

**ctx.notify in write handlers delivers after commit**

Inside a write handler's transaction ctx.notify only records the notification and delivers it once the write has committed, so a rolled-back write sends nothing and leaves no attempt event. Delivery no longer takes a connection from the app pool while the write holds one, which deadlocked at pool max N with N parallel writes. With immediate: true the call stays synchronous and runs its DB work on the outside-transaction pool.

**Migration:** NotifyResult is now a union, NotifyDispatched ({ kind: "dispatched", deliveries }) or NotifyDeferred ({ kind: "deferred" }). In a write handler without immediate: true ctx.notify returns deferred and delivers after commit (a rollback means no notification). Code that reads the result (for example a "send test message" handler showing sent/failed) sets immediate: true, which delivers synchronously on the outside-transaction pool and returns dispatched; narrow on kind before reading deliveries. Errors such as a missing idempotency Redis, a tenant broadcast without the tenant feature or an unknown notification type no longer throw in a deferred write handler, they land in the afterCommit log. Notifications from jobs, from seeding and from handlers without a transaction stay synchronous. The boot default wires tenantUserIdsQuery for to: { tenant } when the tenant feature is mounted, so an app-side tenantUserIdsQuery wiring can go. Custom NotifyFactory implementations receive an optional 4th parameter deliveryDb, and DeliveryService.notify an optional 6th.

**ctx.notify rejects a broadcast to another tenant**

A notify with to: { tenant } now throws an AccessDeniedError (reason notify_foreign_tenant_broadcast) unless the tenant is the caller's own, before any delivery work. In a write handler it fails synchronously instead of landing in the afterCommit log. Notifications fired from seed hooks during self-signup no longer use the app pool inside the signup transaction, which deadlocked at pool max N with N parallel signups; they deliver after commit. ctx.scheduleAfterCommit is now absent in query bridges and post-commit contexts, where hooks pushed to it never ran; callers that check for it (cache-sync announce, set-tenant-tier onAssigned, form-draft discard, seed hooks) now run inline there instead of being dropped.

**Migration:** to: { tenant } must be the tenant of the caller (user.tenantId of the handler or job context), otherwise notify throws; in a write handler the throw is synchronous. Seed-hook notifications in the signup transaction run after commit and return { kind: "deferred" } (immediate: true runs synchronously on the outside-transaction pool, which cannot see rows the signup transaction has not committed yet, so a tenant broadcast there finds no new member). No known consumer broadcasts to a foreign tenant.

### renderer-foundation

**document-pdf requests name a template, the response carries fileName**

The document-pdf payload is { slug, locale, variables } instead of ready HTML in content. The response has a fileName, RendererContext gets an optional filesForTenant (file access per tenant) and RendererError has the new code unavailable for a renderer backend that cannot be reached.

**Migration:** Callers that sent `payload: { content }` switch to a document-pdf template and pass slug, locale and variables (money-horse credit-schedule-pdf follows in #621); renderer-pdf callers pass slug and locale too. The enterprise package @cosmicdriftgamestudio/kumiko-renderer-puppeteer-client no longer builds against these types and is replaced by @cosmicdrift/kumiko-renderer-puppeteer-client.

**RenderRequest kind mail replaces mail-html**

RenderRequest and RenderResponse use kind mail with a MailPayload ({ slug, locale, variables, unsubscribeUrl? }) and a response of { subject, html, text, previewText? }. The export MailHtmlPayload is removed; use MailPayload. The default plugin name for kind mail stays mail-html. RendererContext gains an optional config accessor that plugins use for tenant locale, currency and branding.

**Migration:** Replace kind mail-html with mail in createRendererForTenant and render calls, pass { slug, locale, variables } instead of content/contentFormat, and read the subject from the response instead of building it yourself. Pass ctx.config in the RendererContext to get tenant locale, currency and branding.

**renderer-simple, MailBranding and renderer kind "notification" are removed**

Every mail is a stored template rendered by renderer-mail-html now. renderer-simple (createRendererSimpleFeature, simpleRenderer, createSimpleRenderer, RendererSimpleOptions, mail blocks with LocalizedText, MailBadge, MailChip, MailStage, MailStageState and MailTone), the MailBranding type, the renderer kind "notification" and AuthMailContent are gone. NotificationRenderer and RendererInput are removed from delivery, and createChannelEmailFeature no longer takes a renderer option. The type NotificationPayload is removed from renderer-foundation. The template-resolver keeps "notification" only as a stored kind so legacy rows stay readable; RENDER_KINDS is mail, document-pdf and image-snapshot.

**Migration:** Remove createRendererSimpleFeature() and any renderer or mailBranding option from your feature list and createChannelEmailFeature call. An r.notification that is sent by email needs template + meta (or localizedTemplate) and variables; the sections/header/footer data it carried is replaced by template variables. Branding (logo, footer) now comes from the tenant branding config and the mail layout of renderer-mail-html. Mount template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html (composeRendererStack() mounts all of them) and run seedNotificationTemplates at boot. Existing template rows with kind "notification" are no longer rendered; re-create them as kind "mail" or archive them.

### template-resolver

**document-pdf templates require contentFormat html, and html bodies are sanitized on write**

upsertSystem, upsertTenant, the collection-set handlers and seedSystemTemplate rebuild html bodies of kind mail-html and document-pdf through the new document schema (template-resolver/document-schema). Script elements, inline event handlers, embedded content (iframe, frame, object, embed, applet, portal), links and url attributes (svg href, xlink:href, form action, base) outside https/http/mailto/tel/{{placeholder}}, external image sources, alt text containing < or >, and invalid or prototype-chain variable names are rejected with a validation_error (or a thrown Error in seedSystemTemplate); anything the schema cannot express is dropped silently, and links keep only href (no target, rel, class or title). New exports: documentExtensions, DocumentLink and the other Document* nodes, isAllowedDocumentLinkHref, isDocumentReferenceName, isDocumentResourceKey, isDocumentPlaceholderHref, sanitizeDocumentHtml, sanitizeTemplateBody. kind document-pdf with another contentFormat is rejected with document_requires_html_format.

**Migration:** Store document-pdf bodies as html and reference images via data-resource instead of src. mail-html with markdown or mjml is unchanged.

**kind mail-html is replaced by mail, mail-layout and pdf-layout; templates carry meta**

The kind mail-html is removed; the new non-render kind snippet holds collection content (reply snippets, signatures; any contentFormat, html is sanitized like a mail body). Mail bodies are kind mail (contentFormat html only, rebuilt through the document schema, meta.subject required), mail frames are kind mail-layout (contentFormat mjml), and pdf-layout (html) is new. The table gains a nullable meta column (JSON per kind, validated by parseTemplateMeta: mail takes subject, previewText, layoutSlug, category, sender; layouts take none; other kinds take no meta) and the template-resource entity moves to eventVersion 2 with an upcaster that reads stored mail-html events as mail. upsertSystem, upsertTenant (active), publish and seedSystemTemplate reject unknown placeholders and, for the same writes, bodies that miss a required variable of the notification with the same qualified name; a tenant draft may be incomplete and returns validation. Slugs must be kebab segments joined by a colon. seedSystemTemplate now validates the slug (templateSlugSchema) and the per-kind meta for every kind. A content collection of kind mail, mail-layout or pdf-layout is refused on collection-set (field issue on kind, templateResolver.errors.collection.kindNotAllowed), because such a tenant row would shadow the system template without the meta and placeholder gates. TemplateResource gains meta. New exports: parseTemplateMeta, isMailTemplateMeta, templateSlugSchema, validateTemplatePlaceholders, resolveTemplateVariables, compileDocumentBodyToHandlebars, MAIL_CATEGORIES and their types; seedNotificationTemplates and hasNotificationTemplates on template-resolver/seeding, which applyBootSeeds now calls. RENDER_KINDS contains mail instead of mail-html.

**Migration:** Rename kind mail-html to mail in app code, collections and seeds; mail bodies must be contentFormat html (markdown or mjml mail bodies are rejected) and carry meta.subject, mail layouts use kind mail-layout with contentFormat mjml and slug default. Slugs of every kind must now be kebab segments joined by a colon (upsert handlers and seedSystemTemplate reject dotted, underscored or camelCase slugs). Collections that used kind mail-html move to the new kind snippet (stored mail-html rows are upcast to mail, which collections refuse, so re-create those entries under snippet); collection-set refuses mail, mail-layout and pdf-layout collections. seedSystemTemplate callers must pass a kebab slug and valid meta for every kind, not only mail. Generate and apply the migration that adds the nullable meta column to read_template_resources; it ships a rebuild marker for read_template_resources so existing mail-html rows are read as mail after the rebuild.

**linkedResources is no longer a payload field of upsertSystem/upsertTenant; resourceUpload and resourceRemove manage it**

Two steps - upload the image with POST /api/files (multipart, no entityType), then call template-resolver:write:resource-upload with { sourceFileRefId, templateId?, key? }. The handler re-encodes the caller's own unclaimed upload into a new file ref (width at most 1200 px) and links it into the template; resource-remove unlinks a key. upsertSystem and upsertTenant no longer accept linkedResources and leave the stored value untouched on update. The size cap is the system config key resource-max-bytes (default 2 MiB); a cap above the files route's maxUploadSize has no effect because the upload is rejected first. The source upload stays as an unclaimed file.

**Migration:** Whoever sent linkedResources with upsertSystem or upsertTenant now uploads the image via POST /api/files (multipart, no entityType) and links it with template-resolver:write:resource-upload { sourceFileRefId, templateId, key }. Server-side seeding (seedSystemTemplate linkedResources) stays.

**Tenant mail-layouts are structured html, pdf-layout and document-pdf are placeholder-validated**

A new validate query dry-runs the write pipeline (used, unknown and missing placeholders, canSave, canPublish). document-pdf, pdf-layout and mail-layout now go through the same placeholder gate as mail; document-pdf and pdf-layout know the system placeholders page and pages. A tenant mail-layout is html with a data-content slot plus header, signature and footer regions that renderer-mail-html wraps in a fixed MJML frame; raw mjml (with {{{content}}} exactly once) is system-only. New handlers export-bundle, import-bundle, import-bundle-system and copy-locale move a template with its resource files between tenants and locales. r.notification accepts a record mapping from an entity row to the declared variables, validated at boot. publish and archive no longer touch system rows through a tenant-scoped SystemAdmin.

**Migration:** Tenant mail-layout rows stored as mjml are ignored by the renderer, which falls back to the system layout; re-create them as html with a data-content slot. upsert-system answers with an extra validation field. seedSystemTemplate errors now read `<label> rejected: <code> (<detail>); ...`. Layout bodies without the content slot are rejected on write. `set` now runs the same gate for mail, document-pdf, pdf-layout and mail-layout rows and rejects unsanitized markup or publish issues, since saving publishes; the mail renderer also re-sanitizes stored tenant html layouts and falls back to the system layout when they fail. upsert-system and upsert-tenant no longer accept linkedResources (resources go through the resource upload; bundle import and copy-locale attach them). Unknown data-resource keys are a validate warning (resource_not_uploaded), not a write error.

### user-data-rights

**GDPR default mails are r.notification declarations, render*Email is gone**

export-ready, export-failed, deletion-requested and deletion-executed are declared as trigger-less notifications (user-data-rights:notify:<name>) with variables and localized templates built from the GDPR translations, so a tenant can override the text. The default export-ready, export-failed and deletion-requested mails send through ctx.notify to the user (export mails with immediate so the plain magic-link token never lands in a job payload). deletion-executed renders the seeded template through the mail renderer and sends over the tenant mail transport without a delivery log, because the user is already gone. App-provided send*Email callbacks still win. The defaults now need delivery with channel-email; a boot warning is logged once when mail-foundation and a mail transport are mounted without them. New exports are GdprMailNotificationTypes, gdprMailLocalizedTemplate, gdprMailTemplateLocale, registerGdprMails and formatGdprMailTimestamp.

**Migration:** renderExportReadyEmail, renderExportFailedEmail, renderDeletionRequestedEmail, renderDeletionExecutedEmail and RenderedEmail are removed from user-data-rights/email-templates; the translations stay. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`). Delivery preferences that referenced the mails use the new user-data-rights:notify:<name> types.

### waitlist

**Waitlist confirmation and admin notice use template variables**

The confirmation and admin-notice mails are r.notification declarations (waitlist:notify:confirmation, waitlist:notify:admin-notice) with variables and localized templates. The notify data is the variable object; the confirmation wording is computed in code and passed as variables. The admin notice subject is the submitter name.

**Migration:** Update delivery preferences and tests that referenced the old types or read the sections data. An app that mounts it without includeBundled needs template-resolver, renderer-foundation and @cosmicdrift/kumiko-renderer-mail-html at boot (composeRendererStack() from dev-server mounts all of them), plus a delivery with the channel-email feature; apps without the template tables need a schema migration (`kumiko schema generate`).

## 0.362.0

### framework-core

**Optional number fields in entity forms start empty instead of 0**

**Migration:** An optional number field without default no longer starts at 0 in entityEdit create/edit, and an untouched one is not sent. If a screen relied on the implicit 0, declare default: 0 on the field.

## 0.361.0

### @cosmicdrift/kumiko-dev-server

**runDevApp encrypts PII on ephemeral dev DBs by default**

Without a kms option, runDevApp now configures an InMemoryKmsAdapter and a random blind-index key when KUMIKO_DEV_DB_NAME is unset. With a persistent dev DB nothing changes (plaintext plus warning, pass createPgKmsAdapter to encrypt). RunDevAppOptions.kms also accepts false for explicit plaintext. An app-provided kms keeps its previous behavior, including the boot abort for lookupable fields without a blindIndexKey.

**Migration:** e2e or dev scripts that read PII columns raw must decrypt them or pass kms false to runDevApp. Apps that pass their own kms are unaffected.

### @cosmicdrift/kumiko-renderer

**Searchable lists show their description as its own row**

An entityList or projectionList with search used to hide its description. It now renders as a muted row below the toolbar, the same as on lists without search.

**Migration:** Look at lists that set description together with search. Drop descriptions that were only kept as a hint for developers, or move the text into emptyState if it explains an empty list.

### framework-core

**POST /files checks write access to the target record**

createRecordWriteCheck loads the stored row tenant-scoped and applies update-handler access, entity access.write, field write access and lockedWhen before the upload is stored. Results map to 404, 403 and 409 record_locked. Uploads with an entityId and no check wired are refused.

**Migration:** Grant the uploader the entity's update right for records they attach files to, or upload without an entityId and bind the file on save. Entities without a generic :update handler no longer accept uploads with an entityId. Code that used entityId as a free slot without a stored record must create the record first.

**Unbound uploads are private to the uploader (security)**

The default file access guard denies every operation on a file with no entityType or no entityId unless the caller is the uploader or has a role in privilegedRoles; the file routes answer 404 as for any denied file. Before, files without entityType were readable by the whole tenant and pending uploads until a record claimed them. bindPendingFileRefs now also runs for updates and binds the file ids named in the update's changes for file, image, files and images fields (same entityType and fieldName, entityId null, insertedById = caller), so createFileRefFromBytes with attachTo but no entityId plus a following update write attaches the file to the record.

**Migration:** Code that shows a file without entityType to other users (tenant logo, avatar, mail attachment, import preview, AI-agent output) must upload it with entityType and fieldName of a file field on a record and save the record, so readers of that record can read it; or keep it uploader-only, run the read as a role in privilegedRoles, or set a custom accessGuard in the files feature options. Apps that set accessGuard keep their own decision. Code that reads another user's pending upload before the record is saved must bind the file first or run as the uploader. Known case: solon's document upload posts without entityType and the later document record (created by the ingest job, not the uploader) stores the id in its `fileId` field, so other users no longer read the original; solon must upload with entityType and fieldName of `fileId` and bind the file when the record is created, because a different creator cannot claim the pending upload.

**Plural file fields have a projection column**

files and images fields get a jsonb NOT NULL DEFAULT '[]' column on the entity table (entity-table-meta, buildEntityTable row type readonly string[]) and applyEntityEvent no longer strips them from updated events. Detail and list queries return the ordered id arrays; before, they never carried the field, so an edit form of a saved record showed no files. kumiko schema generate emits an in-place ADD COLUMN for existing tables and no .rebuild.json, so existing rows hold [] until their projection is rebuilt from the events.

**Migration:** Run kumiko schema generate and apply the migration. Existing rows keep [] until the entity projection is rebuilt, so add a rebuild marker before applying: create <NNNN_migration-name>.rebuild.json next to the generated SQL with {"version":1,"tables":["<table name from the ALTER TABLE statement>"]}; kumiko schema apply then rebuilds the projection. Without the marker, call enqueueProjectionRebuild("<feature>:projection:<entity>-entity", { db, registry, jobRunner }) from @cosmicdrift/kumiko-framework/migrations once per entity. Known consumers: solon protocol (attachmentFileIds) and the Wartungs-Demo (photos). Code that read the ids of a plural file field from the event log or from file_refs can read the row field instead.

**Schema generate rejects a table listed twice in ENTITY_METAS**

When ENTITY_METAS contained the same tableName twice, the migration diff kept only the last definition and compared it against the previous snapshot entry, so a new index was written to .snapshot.json but no CREATE INDEX reached the migration SQL. kumiko-schema generate, kumiko-schema validate and programmatic generateMigration now throw (generate and validate exit 1 with a message naming every duplicated table) before any file is written.

**Migration:** Remove hand-added metas for tables a feature already registers from kumiko/schema.ts. Known: phronexsis's schema file appends IN_APP_MESSAGES_META next to collectTableMetas(FEATURES); drop it (and its comment), then run kumiko-schema generate — the existing in_app_messages_tenant_user_created_idx comes out as CREATE INDEX IF NOT EXISTS (no-op) and the two legacy indexes as commented review drops. The duplicate in_app_messages entry in .snapshot.json disappears with that generate.

**Writes with file ids from another tenant are rejected**

A create or update that puts a file id into a file or image field now fails with a ValidationError (code invalid_element, path = field name) when the id is not a UUID, does not exist, or belongs to another tenant. That includes files stored under the SYSTEM tenant. On update only the changed fields are checked. The check runs for every write that returns a save result, inside the transaction, before pending file refs are bound. System users created for a tenant pass with that tenant's own files.

**Migration:** Check seeds, imports and handlers that copy file ids across tenants or reference files uploaded as SYSTEM. Upload the file in the target tenant (or copy it there) before writing its id. A custom handler that writes through an executor directly, without returning a save result, is not covered and needs its own check.

## 0.360.0

### framework-core

**Secure host-only session cookies use the __Host- prefix**

Auth, csrf and tenant cookies are named __Host-kumiko_auth, __Host-kumiko_csrf and __Host-kumiko_tenant when they are written Secure and without a Domain (the tenant cookie is always host-only). With auth.cookieDomain or without Secure the auth and csrf names stay kumiko_auth and kumiko_csrf. New auth option secureCookies forces Secure (default NODE_ENV === "production"). Login deletes the legacy unprefixed host-only cookies, logout and deleteTenantCookie delete the prefixed and the legacy names. The server reads only the resolved names, so a request that carries only the legacy kumiko_auth is anonymous. AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME are removed from the framework and dispatcher-live; the base names and sessionCookieName() are exported from @cosmicdrift/kumiko-types/session-cookies and @cosmicdrift/kumiko-framework/api, getSessionCookies(c) returns the resolved names of a request. The testing package's CSRF_COOKIE_NAME stays and resolves to the unprefixed name (e2e servers run without Secure).

**Migration:** Every user logs in once after the deploy, because the old kumiko_auth cookie is no longer read. Custom clients, proxies or scripts that read or forward the cookies by literal name break: read the names through sessionCookieName() / resolveSessionCookieNames() (types package) or getSessionCookies(c) on the server, and handle both the prefixed and the plain name in browser code (readCsrfToken() already does). Replace imports of AUTH_COOKIE_NAME, CSRF_COOKIE_NAME and TENANT_COOKIE_NAME with AUTH_COOKIE_BASE, CSRF_COOKIE_BASE and TENANT_COOKIE_BASE plus sessionCookieName(); e2e helpers that imported CSRF_COOKIE_NAME from @cosmicdrift/kumiko-dispatcher-live import it from @cosmicdrift/kumiko-testing/e2e instead (known: solon's e2e helpers and specs, and a kumiko-enterprise integration test that uses AUTH_COOKIE_NAME). A reverse proxy that strips or rewrites cookie names must pass the __Host- names unchanged. Staging or preview deployments over plain http need no change (Secure is off there); set auth.secureCookies (also accepted by runProdApp) explicitly when TLS terminates before the app and NODE_ENV is not "production". A standalone createAuthRoutes mount outside buildServer must also mount sessionCookiesMiddleware with the same resolved names, otherwise the readers fall back to the domain-less default.

**Origin guard defaults on when the public app URL is known**

New auth option publicOrigin. Without allowedOrigins, cookieDomain and unsafeSkipOriginCheck, buildServer mounts the Origin guard for cookie-authenticated state-changing /api requests and admits publicOrigin plus the request's own host (Host header). runProdApp sets publicOrigin from auth.publicOrigin, then auth.mail.baseUrl, then the APP_BASE_URL env (origin only, path dropped); with none of them in production it logs a warning that the Origin guard is off and boots anyway. allowedOrigins keeps its strict meaning, and the WebSocket check and the anonymous downgrade still use only allowedOrigins.

**Migration:** Cookie-authenticated POST, PUT, PATCH or DELETE requests from a page on another origin than the public app URL and than the API host itself now get 403 origin_not_allowed in runProdApp deployments that set auth.mail.baseUrl or APP_BASE_URL. A web client served from a different host than the API (for example a sibling subdomain) must list its origin in auth.allowedOrigins. Same-host setups, custom domains served by the same server and Bearer clients need no change.

**Uploads from an update form are attached to the record**

computeEditViewModel accepts entityId (the record being edited, update mode only) and sets it on the hints of file, image, files and images fields; RenderEdit passes the id it was mounted with and the file input sends it as the entityId multipart part of POST /api/files. Create forms send no entityId; after a successful create the write pipeline binds the caller's own pending uploads named in the record's file fields (same entityType and fieldName, entityId null, insertedById = caller) to the new record via a fileRef.updated event in the same transaction, for single and plural file fields alike, when the files feature (fileRef entity) is mounted. Behaviour change: such files are now attached to the record. The default file access guard allows read on an attached file to the uploader, privilegedRoles (default Admin/SystemAdmin) and everyone whose run of the entity's <entity>:detail query returns the record; delete stays uploader and privilegedRoles only. A qr-overlay variant of an image field no longer throws for a file uploaded from an update or create form. Write-form sections send no entityId. EmbeddedListInput has a new required actionsLabel prop.

**Migration:** Files attached through forms now follow the record's read access instead of being tenant-wide: anyone who cannot read the record no longer reads the file, anyone who can read it does. Check image, images, file and files fields whose files must be visible beyond the record's readers (for example an avatar shown in lists to users without detail access) and add those roles to privilegedRoles or set accessGuard in the files feature options. An entity without a detail query falls back to uploader plus privilegedRoles. Files uploaded before the update keep their old attachment. Custom primitive sets that implement EmbeddedListInput accept the new actionsLabel prop and render it as the actions column header; custom file/image Input primitives forward entityId into the upload and offer a remove control that calls onChange(null).

## 0.358.0

### framework-core

**Entity PII fields need whenAbsent: "tenant" when the owner field is nullable**

personal: { of: "<owner>", whenAbsent: "tenant" } makes rows without an owner editable, deletable and forgettable with an active KMS, without plaintext PII. The subject is resolved in this order: the owner on the previous row, the owner the same event sets, then the tenant key (tenant:<tenantId>). Before, an update, delete or forget of an ownerless row failed with SubjectResolutionError (HTTP 500) once a KMS was configured. backfill-pii follows the same chain and checks the projection row for the owner before it falls back to the tenant key; an updated event whose previous.owner is null but whose changes.owner is set no longer loses the owner. Entity fields have no plaintext fallback, so "tenant" is the only value. bundled jobs: cron and system runs (triggeredById null) now store payload, error and log messages as ciphertext under the system tenant key instead of plaintext.

**Migration:** Boot now aborts for a personal: { of: "<owner>" } field whose owner field is not required and that declares no whenAbsent: [Feature X] Field "f" on entity "e" is personal: { of: "ownerId" }, but "ownerId" is not required — rows without an owner would fail to encrypt (SubjectResolutionError, HTTP 500) on update, delete and forget. Declare { personal: { of: "ownerId", whenAbsent: "tenant" } } to encrypt those rows under the tenant key, or make "ownerId" required: true. Entity fields have no plaintext fallback (fw#3654). Fix: add whenAbsent: "tenant", or make the owner field required: true if every row has one. whenAbsent on personal: { of: "id" } throws at declaration. Known consumers: kumiko-enterprise (entities with an ownerUserId, authorId or ownerId owner field) and offlot-app (a lead entity with enquiryId). Existing plaintext job-run rows of cron runs stay readable; new ones are ciphertext.

## 0.357.0

### @cosmicdrift/kumiko-renderer

**List card meta values wrap instead of being clipped; more than 3 meta columns fail boot**

**Migration:** Narrow list cards (entityList, projectionList, relatedList sections, expandableRow) now render meta values as a dot-separated row that wraps onto further lines instead of being cut off after two lines (and no longer subject to a silent runtime cap of 3 values); only a single value wider than the card is truncated. Meta columns are all columns except the title (first column), the status select and columns with hideOnNarrow: true. validateBoot now rejects a list with more than 3 meta columns and names feature, screen, section and fields. Fix: mark the extra columns hideOnNarrow: true (tables keep them) or drop them. collectCardMetaOverflow(features) from @cosmicdrift/kumiko-framework/engine lists all offenders at once. headless now also honors hideOnNarrow on reference, derived, row-meta and renderer-only columns, which it previously ignored there.

**Section actions render in the title row instead of a footer; WriteFormSection submit moves below its fields**

**Migration:** Section.actions (renderer-web DefaultSection) render top right in the title row since #3241, no longer as a footer. A button that depends on content below it (a confirmation checkbox, a list it acts on) belongs in the section's children instead of actions. WriteFormSection's own submit button now sits below its fields; caller actions stay in the title row.

## 0.356.0

### framework-core

**Job ctx.queryAs is gated like ctx.writeAs**

**Migration:** Jobs calling ctx.queryAs with createSystemUser(...) or any identity other than the job's own caller now fail with AccessDeniedError (system_identity_switch_denied / identity_switch_denied). Declare r.systemScope() on the job's feature or escapeHatch: { reason } on the job, the same grant ctx.writeAs already needs. The escape-hatch guard exempts jobs by name, so this surfaces only at runtime; grep your jobs for ctx.queryAs. Known consumer sites: offlot-app channel-text generate-texts.job, campaign-calendar sync, campaign-channel-foundation seed-starter-channels.

## 0.355.0

### @cosmicdrift/kumiko-guards

**Security guards ignore kumiko.json excludes beyond node_modules and dist; kind framework is reserved for kumiko-framework**

**Migration:** Security guards (No-Direct-Fs, Direct-Entity-Writes, Direct-Fetch, Tenant-Escalation, Admin-API, Access-Denied-Test, Open-To-All-Reason, Escape-Hatch-Declared) now scan files matched by your kumiko.json excludes; fix the findings or add a precise guard allowlist entry. A kumiko.json with kind framework outside the kumiko-framework package now fails root resolution; use library or app. Direct-Entity-Writes now sees table arguments behind casts (`table as T`, parentheses, non-null), so a cast no longer hides a direct write. i18n-Locale-Mount handles conditional spreads, alias depth and circular constants.

**test-timeouts guard flags timeout arguments on test(), it() and describe()**

**Migration:** Remove the timeout argument from test/it/describe calls (test(name, fn, 30_000), test(name, fn, { timeout }), also via .skip/.only/.if()/.each()) and fix the cause: poll with waitFor/expect.poll, shrink the data set, share expensive setup in beforeAll. setDefaultTimeout and describe.configure through renamed or namespace bun:test imports are flagged too. A justified remainder gets '// @timeout-exception: #<issue> <reason>' on the line above the call.

### framework-core

**Identity and tenant switches are explicitly gated; escape-hatch audit is durable**

**Migration:** Job ctx.writeAs now needs r.systemScope() on the feature or escapeHatch: { reason } on the job; use ctx.write when the job acts as its own system user. A payload tenantIdOverride is refused by the dispatcher for non-SystemAdmin callers (handlers no longer call crossTenantOverrideDenied, which is removed; use mayOverrideTenant for other cross-tenant fields). Entity convention handlers with a cross-tenant escapeHatch now keep the operator as actor in the row stream (executor option streamTenantId, system-mode db only). createEscapeHatchReporter requires log; pass the runtime logger and share one report window per runtime. EscapeHatchUseEvent and the audit sink payload gain an optional caller. Call flushEscapeHatchAudits() before closing the database on shutdown.

## 0.354.0

### @cosmicdrift/kumiko-renderer

**Grid columns is number | "auto"**

Final review batch F: renderer, renderer-web, types
The boot validator rejects a `listScreenId` that matches no mounted screen, a `sortable` column that the list cannot sort (entityList: any value; projectionList: `true`) and an authored `urlPrefillFields`. `TreeAction` is a union: exactly one of `screen` or `target`. `Button` without children needs `icon` and `ariaLabel`. `RenderEditControls` gains `next` and `back`, and `controls.submit()` saves on an intermediate wizard step. An actionForm money field with a tenant currency that cannot be loaded shows an error instead of submitting with a guessed EUR. The MFA setup and recovery-code buttons sit below the content. The boot context passes Redis to the delivery service, so `notify` with an `idempotencyKey` dedupes. `user:query:user:detail` skips the tenants label when the tenant feature is not mounted.

**Migration:** Pass a number or "auto" to Grid columns; other values no longer type-check.

**Button without children requires icon and ariaLabel**

**Migration:** A custom wrapper that forwards ButtonProps must pass either children or both icon and ariaLabel.

### auth-email-password

**Invitations pin the invitee's membership version; superseded accept no longer relies on timestamps**

**Migration:** New nullable column read_tenant_invitations.membership_version: run `kumiko schema generate` and apply the migration before deploying. Invitations issued before the migration keep the timestamp comparison.

### auth-mfa

**auth-mfa declares the master-key env slots, so composeEnvSchema requires KUMIKO_SECRETS_MASTER_KEY_V1 when auth-mfa is mounted**

Review batch H1: framework parts of consumer-app findings.
- `auth-email-password` exports `issueSignupActivation` (invalidate, mint, store and mail an activation link; the signup-request handler now runs on it), `SIGNUP_ACTIVATION_NOTIFICATION_TYPE`, `storeSignupToken`, `invalidateExistingSignupToken`, `normalizeEmail` and `SIGNUP_TOKEN_KEY_PREFIXES`.
- `auth-mfa` declares the master-key env slots (`KUMIKO_SECRETS_MASTER_KEY_V1`, `_CURRENT_VERSION`, the `_CIPHERTEXT` twin) as a shared fragment with `secrets`, so a rotated `V<n>` slot is unpacked even without `secrets` mounted.
- `user-data-rights` exports `TENANT_MODEL_CONFIG_KEY`; `createTemplateResolverApi` takes a `DbRunner`.
- The user menu's logout item carries `data-testid="user-menu-logout"`.
- renderer-web: a `Field` description is linked to its text input via `aria-describedby`; the facet filter dropdown is capped to the available viewport height and scrolls; `createBrowserLocaleResolver` takes `normalizeLocale` and the default storage key is exported as `BROWSER_LOCALE_STORAGE_KEY`.
- testing: `loginViaApi(request, credentials, { bucketKey })`, `CLIENT_IP_HEADER` from `@cosmicdrift/kumiko-testing/e2e`, and a Playwright-free `@cosmicdrift/kumiko-testing/e2e/constants` subpath (`KUMIKO_SECRETS_MASTER_KEY_V1`).

**Migration:** Apps that bring their own masterKey provider instead of the env KEK add "auth-mfa" to composeEnvSchema's optionalFeatures, like they already do for "secrets". Required wins as soon as auth-mfa is not in optionalFeatures, even when `secrets` is listed there.

### billing-foundation

**BillingInfo.prices and getBillingPrices are keyed by the tier union**

**Migration:** A getBillingPrices that returns keys outside your tier union no longer compiles; remove or rename those keys.

### delivery

**POST /resubscribe requires the undo token from the POST /unsubscribe response**

**Migration:** Clients that called the resubscribe route with the unsubscribe token must send the undo token instead: read it from the hidden token field of the page POST /unsubscribe returns (aud kumiko:resubscribe, valid for 1 hour). The unsubscribe token is rejected on /resubscribe with 400, and the undo token is rejected on /unsubscribe.

### files

**FileHandle.derive throws for suffixes outside <name>-<16 hex>**

Final review batch D.
- `FileHandle.derive(suffix)` now throws unless the suffix is `<name>-<16 hex>` (build it with `variantSuffix(name, spec)`). Free-form suffixes such as `derive("thumb")` wrote keys the forget/tenant-destroy sweep could not recognize, so those binaries survived erasure. Callers passing a bare name must switch to `variantSuffix`.
- `resolveKmsWiring` / `requireKmsWiring` throw when a `*_CIPHERTEXT` slot is set without its plaintext, pointing at the async entry points, instead of a misleading "trio required" error or a silent plaintext-PII fallback.
- Event-PII owner/`whenAbsent` resolution now also runs without a configured KMS, so a missing owner fails in dev like in prod.
- PII event backfill queues rebuilds under a per-run migration id, so a peer replica's re-queue is no longer cleared by another run.
- `seedAdminGuarded` re-writes the canonical admin's email so the blind index is repaired, and skips undecryptable foreign user rows instead of aborting the boot seed.
- A tenant-bound `FileContext.list` refuses prefixes outside the tenant's key space.
- An entityList whose create screen was dropped for the caller's roles now carries `createUnavailable`, so the renderer no longer falls back to a generic create form.
- Boot validation rejects an object-form `redirect` with `idFrom` whose same-feature target screen carries no id.
- `defineFeature` throws when `dedupeOptions` holds a nested object (it can never compare equal across two mounts).
- `FileContext.ref` and `list` (tenant-bound) refuse keys outside `${tenantId}/`; list columns accept `virtual: true`; `httpRoute` session-only routes now pass the global IP rate limit; tenant timezone cache TTL is 30 s; text fields without a personal stance warn at boot; the orphan-derivative sweep keeps derivatives whose original still exists; `piiFields` owner fields that can never yield a string throw unless `whenAbsent` is set.

**Migration:** Build the suffix with variantSuffix(name, spec) instead of passing a free-form string.

**A tenant-bound FileContext.list throws for prefixes outside the tenant's key space**

**Migration:** Pass a prefix that starts with `${tenantId}/`.

**A tenant-bound FileContext.ref throws for keys outside the tenant's key space**

**Migration:** Use keys that start with `${tenantId}/`.

### framework-core

**enrichWithReferences and enrichRowWithReferences require a viewer { user, parentVisibility }**

**Migration:** Custom handlers pass `{ user: query.user, parentVisibility: { entities: ctx.registry.getAllEntities() } }` as the fifth argument. No direct callers are known in the workspace apps. Apps can now point reference fields at team- or row-scoped entities (for example solon's unitId and propertyId).

**crossTenant removed from entity convention handlers; write handlers with escapeHatch need SystemAdmin-only access**

**Migration:** Replace crossTenant: true with escapeHatch: { reason } (run bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/migrate-cross-tenant.ts, then replace its placeholder reason, which is rejected otherwise). A create/update/delete/restore handler with escapeHatch must declare access: { roles: ["SystemAdmin"] }; list and detail handlers keep their access.

**Field-level access.read with a where-rule now fails the boot (also on embedded sub-fields)**

**Migration:** Replace the where-rule on the field with a from()-rule (e.g. from("user:id", "ownerId")) or move the where-rule to entity access.read. Field read access is evaluated in memory and could never grant a where-rule, so it only hid the field.

**requestContext.run and runAsDirectCallEntry removed from the public /api barrel; requestContext there is read-only**

**Migration:** Import run and runAsDirectCallEntry from @cosmicdrift/kumiko-framework/internal/request-context; reserved for agent-tools and server runtime wiring, do not use to lift a handler past the risk floor. requestContext.get() from /api is unchanged.

**TenantDestroyHookResult: done:false now requires processed**

**Migration:** Tenant destroy hooks that return { done: false } must also return processed (number of items handled this tick). A tick with processed 0 now counts as a failed stage attempt.

**db.global(table) writes on executor-managed entity tables are rejected**

Database, event-store consumer, search and Redis review fixes
`db.global(table)` writes are rejected on executor-managed entity tables, and `unsafeRaw` handles derived through `begin`, `transaction` or `reserve` keep the personal-data gate. Reference sorting and search re-check label and read access plus ownership, and a stale search index can no longer surface another tenant's row. A cross-tenant convention handler reports one audit event per touched row with that row as target.
A failing dispatcher pass no longer records its error on a consumer whose cursor moved in the meantime and skips a row another pass holds locked. A projection rebuild aborts when the configured blind-index key differs from the one used to build the live table. An array `ne` filter on a jsonb column means "does not contain all of these", matching the entity list filter. `date` columns that still hold a timestamptz log a warning once per column.
`kumiko_event_dispatcher_listen_connected` only drops to 0 on a real connection-loss error and is restored when the pre-check recovers. A consumer logs once when it tracks more than 1000 pending gap ranges. The lazy Meilisearch default config no longer overwrites settings stored by an earlier `configure()` after a restart.
Access invalidation publishes through `PubSubSignal.publishConfirmed`, so a Redis failure fails the consumer and the event is redelivered instead of being dropped (`SseBroker.publishAccessInvalidation` may return a promise). `KUMIKO_REDIS_CHANNEL_PREFIX` namespaces the SSE and feature-toggle Pub/Sub channels for apps sharing one Redis; `createRedisToggleSyncSignal` takes the prefix as an optional third argument. Types that mention `Temporal` now carry the `temporal-polyfill/global` reference into their `.d.ts` files.

**Migration:** Write entities through the entity executor and keep db.global for hand-written unmanaged tables.

**defineFeature throws when dedupeOptions holds a nested object**

**Migration:** Flatten dedupeOptions to primitive values.

**Boot validation rejects an object-form redirect with idFrom on a screen that has no id**

**Migration:** Point the redirect at a screen with an id or drop idFrom.

**A list column absent from the query output schema must set virtual: true**

**Migration:** Add virtual: true to computed columns that are not part of the query output.

**Boot validator rejects inert sortable, authored urlPrefillFields and an unknown listScreenId**

**Migration:** Remove sortable from entityList columns and sortable true from projectionList columns (declare sorting on the entity field), remove urlPrefillFields from form screens (buildAppSchema derives it from navigate params), and point listScreenId at a mounted screen short id.

**TreeAction is screen XOR target at the type level**

**Migration:** Give every createAction and actions[] entry either screen or target, not both and not neither; the boot validator already rejected the other forms.

### jobs

**jobs: store_tenant_job_failures holds at most one row per (tenant, job, subject)**

**Migration:** store_tenant_job_failures now enforces one row per (tenant_id, job_name, subject) through two partial unique indexes; parallel final failures serialize on an advisory lock. kumiko schema generate does NOT produce the dedup, and the unique index would fail on existing duplicates, so hand-edit the generated migration to contain exactly: DELETE FROM "store_tenant_job_failures" a USING "store_tenant_job_failures" b WHERE a."tenant_id" = b."tenant_id" AND a."job_name" = b."job_name" AND a."subject" IS NOT DISTINCT FROM b."subject" AND (a."failed_at", a."id") < (b."failed_at", b."id"); CREATE UNIQUE INDEX IF NOT EXISTS "store_tenant_job_failures_tenant_job_subject_uidx" ON "store_tenant_job_failures" ("tenant_id", "job_name", "subject") WHERE subject IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS "store_tenant_job_failures_tenant_job_null_subject_uidx" ON "store_tenant_job_failures" ("tenant_id", "job_name") WHERE subject IS NULL; DROP INDEX IF EXISTS "store_tenant_job_failures_tenant_job_subject_idx"; The DELETE keeps the newest row per key (by failed_at, then id).

### ledger

**Schedule sourceRef is unique per tenant (partial unique index read_ledger_schedules_tenant_id_source_ref_uidx)**

**Migration:** sourceRef is now unique per tenant: a second createSchedule (or updateSchedule) with a sourceRef already used in the same tenant fails with unique_violation (HTTP 409). Schedules without a sourceRef and the same sourceRef in different tenants stay allowed. Before applying, check for duplicates: SELECT tenant_id, source_ref, count(*) FROM read_ledger_schedules WHERE source_ref IS NOT NULL GROUP BY tenant_id, source_ref HAVING count(*) > 1; and resolve them through real writes (updateSchedule with another sourceRef). kumiko schema generate treats the new unique index on a managed projection as destructive (DROP TABLE + CREATE TABLE + .rebuild.json); a rebuild would also hit the unique index on historical duplicates. Hand-edit the generated migration: replace the generated DROP/CREATE with exactly DROP INDEX IF EXISTS "read_ledger_schedules_tenant_id_source_ref_idx"; CREATE UNIQUE INDEX IF NOT EXISTS "read_ledger_schedules_tenant_id_source_ref_uidx" ON "read_ledger_schedules" ("tenant_id", "source_ref") WHERE "source_ref" IS NOT NULL; and discard the generated .rebuild.json (delete the file, do not commit it). Code that does find-then-create by sourceRef should expect unique_violation on create and re-read the schedule that won the race.

**A ledger schedule needs subjectType and subjectId together or neither**

**Migration:** Create and update schedule calls that set only one of the two fields now fail validation. Send both fields or neither.

### notes-history

**notes-history adds a composite index on (tenantId, entityType, entityId) for note entries, so the schema-drift check fails until the app regenerates**

Review batch H2: framework parts of consumer-app findings.
- `file-derivatives`: the `isPublic` predicate args carry `fileRefId`, so a predicate can reject a client-spoofed FileRef that claims another entity's `entityId`/`fieldName`.
- `sessions`: `createSessionsFeature({ adminAccess: "systemAdmin" })` narrows the admin list/detail queries and both admin screens together (default `"admin"`, unchanged).
- `user-profile`: `change-email` is open to every signed-in user (`openToAll`), so a tenant member whose only role is `TenantAdmin` can change their own email; the handler still re-checks the password.
- `notes-history`: composite index on `(tenantId, entityType, entityId)` for note entries. Apps run `kumiko-schema generate` after the bump.
- guards: `// kumiko-lint-ignore a,b reason` suppresses several guards on one line (`lineHasIgnoreTag`); `primitives-discipline` and `no-custom-primitives` honour it.
- dev-server: `kumiko-build --check` verifies `.kumiko/` is current without writing (exit 1 on drift); `runCodegen` takes `checkOnly`.

**Migration:** Run `kumiko-schema generate` in apps that mount notes-history and commit the generated migration.

### tenant

**createTenantFeature fails the boot when a declared assignable app role is missing from its assignableAppRoles option**

Final review batch E1: bundled features
`createTenantFeature` now fails the boot when an `assignableRole` declaration is missing from its `assignableAppRoles` option, because the members and invite screens would otherwise omit the role and a save of the member-roles form would silently strip it. `composeFeatures(includeBundled)` already passes the option. Agent-callable handlers that change access or books now resolve risk `high`: `tenant:write:disable`, `tenant:write:updateMemberRoles`, `user:write:user:update`, `tier-engine:write:set-tenant-tier`, `ledger:write:create-transaction` and `ledger:write:reverse-transaction`. `in_app_messages` gets a `(tenant_id, user_id, created_at)` index. `GET /files/:id/download-url` no longer puts a personal `fileName` into the signed URL; the hint carries a neutral name derived from the MIME type, while `GET /files/:id` still sends the real name in its response header. The forget-subject denial audit event goes through the shared `appendDomainEventCore`, which the pipeline barrel now exports.

**Migration:** Pass assignableAppRoles: collectAssignableAppRoles(appFeatures) to createTenantFeature when you mount it by hand; composeFeatures(includeBundled) already does.

### user-data-rights

**Row-bound grants (deletion token, tenant handover) refuse a colon in anchor or subject**

**Migration:** signRowBoundGrant now throws when the anchor or subject contains ":", and redeem returns FAILED for such a token. Use colon-free ids (uuids) for anchor and subject; a purpose may still contain a colon.

## 0.353.0

### tenant

**Tenant names are encrypted under the tenant record and crypto-shredded when the tenant is destroyed**

Tenant names are PII encrypted under the tenant record and crypto-shredded on tenant destroy
`tenant.name` is now `personal: { of: "id" }`, so it is stored as `kumiko-pii:` ciphertext in events and in `read_tenants`. Signup no longer writes the email into the tenant name; it uses the generated tenant key. The tenant destroy job erases the tenant record key and purges the tenant's search documents. The tenant queries (`me`, memberships, tenant-directory, user list, cap-overview, tenants-missing-profile) decrypt the name, and the tenant list sorts by `key` because encrypted names are not sortable.

**Migration:** After the bump run the PII backfill (backfillEventPiiEncryption), then rebuild the read_tenants projection; the backfill only encrypts event payloads. Raw reads of read_tenants.name in apps now return ciphertext and must go through decryptStoredPii or the tenant query handlers. Tenants that were already destroyed (read_tenants.destroyed_at set) get the erased sentinel instead of a fresh record key.

## 0.352.0

### @cosmicdrift/kumiko-guards

**upgrade-state guard fails on open manual upgrade steps**

Every entry in the marker's pendingManual list now produces a guard violation until it is resolved.

**Migration:** Run `kumiko-upgrade --resolve <id> --reason "<what you did>"` for each open step once you applied it, or add `--not-applicable` when it does not concern your repo. The guard passes when no manual step is left open.

### @cosmicdrift/kumiko-types

**Apps must import Temporal from @cosmicdrift/kumiko-types/temporal instead of temporal-polyfill (affects every app since 0.351.0)**

Since 0.351.0 the native globalThis.Temporal wins over the polyfill. A Temporal imported from "temporal-polyfill" is a second implementation, so instanceof and z.instanceof(Temporal.Instant) reject values the framework creates. This applies whether you upgrade from before 0.351.0 or are already on it.

**Migration:** Replace every value import from "temporal-polyfill" in app code and tests, e.g. `import { Temporal } from "temporal-polyfill"`, with `import { Temporal } from "@cosmicdrift/kumiko-types/temporal"`, and drop side-effect imports of "temporal-polyfill/global" (importing @cosmicdrift/kumiko-types/temporal already installs the global when the runtime has none). `import type` and `/// <reference types="temporal-polyfill/global" />` may stay. Then run `kumiko check`; the No-Temporal-Polyfill-Import guard lists anything left. Close the step with `kumiko-upgrade --resolve <id> --reason "<what you changed>"`, or add `--not-applicable` when the repo never imported temporal-polyfill.

### cap-counter

**Calendar cap reservations are stored in the new store_cap_reservations table**

Capped writes now insert and delete rows in store_cap_reservations, so they fail until the table exists.

**Migration:** Generate and apply a migration with `kumiko-schema generate` — capped writes fail without the new store_cap_reservations table

### delivery

**Delivery attempt log stores masked recipient addresses; attempts older than 90 days are pruned**

The log query, the export and the stored events show masked addresses, and the feature registers the daily attempt-log-retention job.

**Migration:** Read recipients from your own data, not from the attempt log, because it only shows masked addresses now. Set `attemptLogRetentionDays` on createDeliveryFeature to another number of days, or to `false` to keep the log, if 90 days does not fit. Schedule nothing extra, the feature registers the cron job itself. Existing full-address entries are removed by the retention job once they are older than the window, or erased when their user is forgotten.

## 0.346.0

### step-dispatcher

**r.step.webhook.send drops the unused retry option**

`r.step.webhook.send` no longer accepts `retry`
The option was never applied: every dispatch request is delivered once. Passing it is now a type error, and the dispatch-requested payload no longer carries it. Stored events that still contain `retry` are parsed and delivered as before.

**Migration:** Remove `retry` from `r.step.webhook.send` calls; it was never applied. Each dispatch request is delivered once; a delivery error ends as step.dispatch-failed.

## 0.344.0

### billing-foundation

**Consumer-protection gaps - per-locale legal links, gate order, confirmation mail, exports**

All changes below apply only when `createBillingFoundationFeature` gets `consumerProtection`. Apps without it behave as before.
`ConsumerProtectionOptions.legalLinks` takes either one `LegalLinkSet` or one set per consent locale (`{ de, en }`, both required). `BillingPlansResult.consumerProtection.legalLinks` is now always `Record<"de" | "en", LegalLinkSet>`; a single set is returned for both locales. Code that reads `legalLinks.terms` from the billing-plans result must read `legalLinks[locale].terms`. `CheckoutConsentDialog` picks the set for the consent locale.
`FALLBACK_CONSENT_LOCALE` is now `"en"` (was `"de"`). A locale other than de/en, or none, resolves to English in `resolveConsentLocale`, the consent gate, the confirmation mail's VAT note and the termination record.
`create-checkout-session` with consumer protection now checks in this order: provider, billing enabled, redirect origins, price and subscription gates, then the live price (new `UnprocessableError` `price_unavailable` when the provider cannot return it), then the consent, then the provider call. A missing consent no longer hides a disabled provider, an existing subscription or an unknown price. Its payload schema is strict, so unknown fields are rejected. `assertCheckoutAllowed` and `startProviderCheckout` split `openCheckout` in checkout-core.
New option `ConsumerProtectionOptions.oneOffItemLabel(ctx, priceId)`: the server resolves the label of a one-off item (for example a credit pack). It is stored on the consent event as `itemLabelKey` / `itemLabelParams` and shown in the confirmation mail as "Leistung" / "Item". The client cannot set it.
The terms text block is read from the system tenant, not from the buyer's tenant, in the consent gate and the confirmation mail. A tenant-owned block with the same slug no longer changes `termsHash` or the mailed text.
The confirmation mail shows dates in the recipient's time zone (user zone, else tenant zone, else UTC) with the zone name, renders the terms as Markdown with real headings and shows the translated plan name (`catalog.tierLabelKey`, looked up through the registry i18n, so the key must be qualified with the registering feature; untranslated keys fall back to the raw tier). Its opening sentence starts with a capital letter.
New exports: `consentPayloadSchema`, `ConsentPayload`, `OrderItem`, `CONSENT_LOCALES`, `ConsentLocale`, `resolveConsentLocale`, `LegalLinkSet`. The `/web` entry adds `CheckoutConsentDialog`, `CheckoutConsentDialogProps`, `CheckoutConsentPayload`, `CONSENT_TEXT_OUTDATED_CODE`, `resolveConsentLocale`, `ConsentLocale` and `LegalLinkSet`. `CheckoutConsentDialog` `price.count` is optional, and the "cancel at any time" note only shows for a recurring price (`price.renewalKey` set).
The checkout and cancel dialogs no longer repeat the modal title as a heading, and the cancel-contract button is hidden once a cancellation is scheduled.

**Migration:** Only apps that pass consumerProtection are affected. BillingPlansResult.consumerProtection.legalLinks is now keyed by locale (legalLinks.de / legalLinks.en). FALLBACK_CONSENT_LOCALE changed from de to en. create-checkout-session rejects unknown payload fields when consumer protection is on.

## 0.343.0

### delivery

**Delivery errors are fixed codes instead of raw messages**

Delivery stores and returns only fixed error codes, never raw error messages. `delivery_attempts.error`, the `deliveryAttempt` event, `NotifyResult.deliveries[].error` and the job failure now hold one of `DELIVERY_FAILURE_CODES` (`timeout`, `network_error`, `redirect_blocked`, `host_not_allowed`, `missing_credentials`, `invalid_address`, `unexpected_response`, `render_failed`, `send_failed`, `channel_error`), one of `DELIVERY_SKIP_REASONS`, or `http_<status>`. A throwing channel ends as `send_failed` or `render_failed`; a failure around resolve or dispatch ends as `channel_error`. The full error goes to the log with URLs and email addresses redacted. `redactUrls` and `redactErrorText` are new next to `redactEmailAddresses`, which moved out of the step dispatcher.
`@cosmicdrift/kumiko-framework/engine` exports `DELIVERY_FAILURE_CODES`, `DELIVERY_SKIP_REASONS`, `isDeliveryErrorCode` and the types `DeliveryErrorCode`, `DeliveryFailureCode`, `DeliverySkipReason` and `ChatSendFailureCode`. `NotifyDelivery.error`, `ChannelResult.error` and `DeliveryLogEntry.error` are now `DeliveryErrorCode`. `delivery:query:log` returns `channel_error` for stored rows that still hold free text.

**Migration:** NotifyDelivery.error is now a DeliveryErrorCode. Code that matches on error text must match the code instead (for example send_failed). Custom channels must return a DeliveryErrorCode in ChannelResult.error. Existing attempt events keep their free text; reading them through delivery:query:log masks it as channel_error.

### framework-core

**App error reasons only carry a docsUrl when errorDocs covers them**

`docsUrl` in error responses is now resolved at serialization by `resolveErrorDocsUrl`. Framework reasons (and errors without a reason) link to the framework docs as before. An app's own reasons no longer link to the framework docs, where no page exists for them: they get a `docsUrl` only if the new option `errorDocs: { baseUrl, reasons: string[] | "all" }` (on `runProdApp`, `buildServer`, `createKumikoServer`, `setupTestStack`) covers them.
Migration: `KumikoError.docsUrl` (the getter) is removed; use `resolveErrorDocsUrl(err, errorDocs?)`. `ErrorResponseBody.docsUrl` is now optional. Apps whose clients read `docsUrl` for app reasons pass `errorDocs` or handle the missing field.

**Migration:** KumikoError.docsUrl (the getter) is removed; call resolveErrorDocsUrl(err, errorDocs?) instead. ErrorResponseBody.docsUrl is optional. Apps whose clients read docsUrl for app reasons pass errorDocs or handle the missing field.

## 0.342.0

### @cosmicdrift/kumiko-cli

**kumiko check requires uiRoots for kind "app"**

`kumiko check` fails a kind "app" without uiRoots
A repo with `kind: "app"` and no `uiRoots` used to skip the UI guards silently. `kumiko check` (also with `--explain`) now prints an error and exits 1 before any step runs. Declare `uiRoots`, or set `uiRoots: []` for an app without UI; the step list then shows that the UI guards are skipped on purpose. A repo that relies on the derived manifest also gets the hint to add a `kumiko.json`. Other kinds are unchanged. `kumiko new app` now writes a `kumiko.json` with `uiRoots: ["src/features/*/web"]`.

**Migration:** Add `uiRoots` to the `kumiko.json` of every `kind: "app"` repo, for example `["src/app", "src/features/*/web"]`, or `[]` for an app without UI. A repo without a `kumiko.json` needs one first, since the derived manifest cannot declare uiRoots.
Workspace state at release: kumiko-platform, offlot-app, phronexsis and show-pony declare `kind: "app"` without `uiRoots`.

### framework-core

**Key Manager slots are required, LEGACY_SLOTS default removed**

Key Manager slots are required: no more LEGACY_SLOTS default
`resolvePlatformKeks`, `resolveKmsWiringAsync` and `requireKmsWiringAsync` no longer fall back to the three platform slots; `slots` is a required option. `runSchemaCli` called with `features` now requires `kmsSlots` and exits 1 with a hint before any DB connect or migration apply when it is missing. `kmsSlots: []` stays valid for apps that wire no Key Manager slots. The scaffolded `bin/kumiko.ts` passes `kmsSlots` derived from the composed env schema.

**Migration:** Pass `slots` (for example `kmsSlotsOf(<app>ComposedEnv.schema)`) to `resolvePlatformKeks`, `resolveKmsWiringAsync` and `requireKmsWiringAsync`. In `bin/kumiko.ts`, `runSchemaCli(..., { features })` needs `kmsSlots: kmsSlotsOf(<app>ComposedEnv.schema)` (or `[]` when the app wires no Key Manager slots. With `[]` every `*_CIPHERTEXT` env var is ignored, so an app that ships a ciphertext must pass its slots); without it the CLI exits 1 before applying migrations.
Workspace state at release: show-pony `bin/kumiko.ts` and its copy in the kumiko-platform docs samples still call `runSchemaCli` with `features` only. publicstatus, solon, offlot-app, money-horse, phronexsis and kumiko-studio already pass `kmsSlots` / `slots`.

## 0.341.0

### @cosmicdrift/kumiko-dev-server

**Deploy migrate-step.sh always uses the exact stack network**

The discover variant (docker network ls | head -1) could pick another compose project's network on a shared host. The script now uses COMPOSE_PROJECT_NAME or the directory name plus _stack.

**Migration:** Remove package.json kumiko.deploy.stackNetwork (or set it to "directory"), then re-run scaffoldDeploy. If the deploy directory name differs from the compose project, set COMPOSE_PROJECT_NAME for migrate-step.sh.

### @cosmicdrift/kumiko-guards

**Repo-local direct-fs exceptions with a frozen reason, bundled read-only assets**

`guard-no-direct-fs` has a repo-local exception: `// kumiko-lint-ignore direct-fs <reason>` on the `node:fs` import (or the line above) suppresses the finding only while the `<file>::<reason>` pair is frozen in `.kumiko-direct-fs-baseline.json` at the repo root. It fails closed: without a baseline file, with an unreadable file, with a changed reason, or with more markers than frozen, the finding stays. A bare tag without a reason does not count. Freeze with `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"`. The guard hint now points to the marker, `FileStorageProvider` and `readBundledAsset`. `AstGuard.writeBaseline` receives the scanned roots as an optional second argument, and `baselineRatchet` takes an opt-in `failClosed` that treats a missing baseline file as empty.
**Migration (breaking-ish):** the framework allowlist no longer contains `src/marketing/render-landing.ts` and `src/marketing/rebuild-pages-job.ts` for every repo. Apps that have these files (today money-horse, phronexsis, show-pony, publicstatus) put `// kumiko-lint-ignore direct-fs <reason>` above the `node:fs` import in each file and run `kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard"` once in the app repo. Commit the generated `.kumiko-direct-fs-baseline.json`.
`@cosmicdrift/kumiko-server-runtime` can ship read-only files from an app's own build. Declare them in `package.json` under `kumiko.assets` (`[{ "name": "inter-bold.ttf", "source": "packages/site-kit/fonts/inter-bold.ttf" }]`, `source` relative to the app's `package.json`). `buildProdBundle` copies them to `dist/kumiko-bundled-assets/`, which the static file server does not serve, and fails the build on an invalid name, a duplicate, a source outside the package or a missing file. `readBundledAsset(name)` and `resolveBundledAsset(name)` read the dist copy in prod and the declared source in dev, so apps need no `node:fs` for it.

**Migration:** The allowlist no longer frees src/marketing/render-landing.ts and src/marketing/rebuild-pages-job.ts in every repo. Put // kumiko-lint-ignore direct-fs <reason> above the node:fs import in each such file, run kumiko-guards guards --write-baseline --guard="No-Direct-Fs Guard" once and commit .kumiko-direct-fs-baseline.json.

### auth-email-password

**Invitations can carry a global role (SystemAdmin), granted only on accept**

New system-only handler auth-email-password:write:system-invite-create and bootstrapTenants() for idempotent passwordless provisioning. Tenant admins cannot set global roles; a re-invite clears a pending one.

**Migration:** New column read_tenant_invitations.global_roles: run `kumiko schema generate` and apply the migration before deploying.

### auth-mfa

**MFA required policy is writable by the system only**

**Migration:** Tenant admins can no longer write auth-mfa:config:required (write access is now system-only). Set the app-wide default with createAuthMfaFeature({ requiredPolicy }) / the mfa options and per-tenant overrides with runBootstrap tenants[].config or a system write (createSystemUser). Code that wrote the key as TenantAdmin/Admin/SystemAdmin over HTTP must switch to one of these.

### channel-telegram

**Telegram apiBaseUrl must match allowedHosts and use https**

`ctx.secrets.set` now runs the same `valueSchema` check as `secrets:write:set` and throws the same validation error (`secrets.errors.invalidValue`, never carrying the value) before anything is encrypted or stored. `createSecretsContext` takes a required `registry` option that supplies the declared schemas; `runProdApp`, `runDevApp` and `setupTestStack` setups pass the booted registry.
`createChannelTelegramFeature` takes `allowedHosts` (default `["api.telegram.org"]`) and `requireHttps` (default `true`), like the other chat channels. Boot fails when the host of `apiBaseUrl` is not in `allowedHosts` or the URL is not https while `requireHttps` is on. Before, the host of `apiBaseUrl` was its own allowlist and https was only required when the URL already started with `https:`.

**Migration:** An app that sets a custom apiBaseUrl (self-hosted Bot API server, local test server) must also pass allowedHosts: ["<host>"], plus requireHttps: false for plain http. Without it the app fails at boot.

### delivery

**Chat channels deliver in production boot, ctx.notify returns a NotifyResult**

Chat channels (slack, discord, teams, telegram) now deliver in production boot. `runProdApp`, `runDevApp` and `runWorkerApp` pass the tenant secrets to the delivery service and hand queued channels to the `delivery.render`/`delivery.send` jobs of the calling context's job runner. `delivery.render` now receives `ctx.secrets` as well. Without a job runner, queued channels still deliver inline, now with secrets. `runBootstrap` is a one-shot process whose queue nobody drains after it exits, so it keeps delivering queued channels inline (the SystemAdmin invitation goes out before the process ends).
`NotifyFn` returns a `NotifyResult` (`{ deliveries }` with channel, recipientId, status `queued | sent | failed | skipped`, error and `deliveryAttemptId` per delivery) instead of `void`. `NotifyOptions.immediate` delivers queued channels inline for one call and bypasses job retry, for "send test message" handlers. `NotifyFactory` takes an optional job dispatcher as third argument, and `DeliveryService.notify` an optional per-call dispatcher.
Consumers: `NotifyFn` implementations in tests and mocks must now return a `NotifyResult`, e.g. `async () => ({ deliveries: [] })`. When running the API without a worker (`runSingleInstance: false`), a dedicated worker must process the delivery jobs.

**Migration:** NotifyFn implementations in tests and mocks must return a NotifyResult, e.g. async () => ({ deliveries: [] }). Queued channels now run through the delivery jobs in production; an API-only deployment (runSingleInstance: false) needs a worker that mounts delivery and the channel features.

### secrets

**ctx.secrets.set validates against the declared valueSchema**

**Migration:** Code that calls createSecretsContext({ db, masterKeyProvider }) must also pass registry (the booted Registry). Programmatic ctx.secrets.set calls with a value that fails the key's valueSchema now throw a ValidationError instead of storing it.

## 0.339.0

### framework-core

**fetchForWriting handles reject appends after a concurrent write**

**Migration:** Appends through a ctx.fetchForWriting handle now use the version the handle was read at. When two requests write the same aggregate concurrently, the later append no longer stacks on top silently: the request fails with 409 version_conflict (no automatic retry), and its transaction rolls back. Tests that fire concurrent writes on one aggregate and expected both to succeed must expect exactly one success. Clients should treat 409 version_conflict like a stale form: reload and retry.

**ctx.db.unsafeRaw() takes no reason; the audit uses the declared escapeHatch reason**

`TenantDb.unsafeRaw` is now `unsafeRaw(): DbRunner`. The `unsafe-raw` audit entry carries the reason from the `escapeHatch` declaration, as before. Calls without a matching declaration are still rejected with an `AccessDeniedError`.

**Migration:** Replace `ctx.db.unsafeRaw("...")` with `ctx.db.unsafeRaw()`. The reason lives only in `escapeHatch: { reason }` on the handler, hook or job; TypeScript flags old calls. `ctx.systemDb.unsafeRaw(reason)` is unchanged.

### workflow-runner

**workflow-run stream stores a reference to the trigger event instead of its payload**

`workflow.run-started` now holds `triggerEventRef: { eventId, aggregateId, version }` and no `triggerPayload`; the wait, waitForEvent and retry step events no longer embed it either. `workflow_run_pending` gets a `trigger_event_ref` column and the event-subscriber stops writing `trigger_payload`. `resume-run` loads the trigger and the awaited event through `ctx.loadAggregate` and fails the run with `trigger_event_unavailable` or `awaited_event_unavailable` when one is gone.

**Migration:** Own code that reads `triggerPayload` from `workflow.run-started` must read `triggerEventRef` and load the event with `ctx.loadAggregate(ref.aggregateId)`. Apps generate the migration for the new `workflow_run_pending.trigger_event_ref` column with `kumiko schema generate`. The step events `workflow.step.waiting`, `workflow.step.waiting-for-event` and `workflow.retry.scheduled` no longer carry `triggerPayload`; a custom resume loop that read it must load the trigger event through the `triggerEventRef` on its own run-started event (see `samples/recipes/workflow-engine/src/postgres-resume-loop.ts`). Stored run-started events and pending rows keep their old copy; this release rewrites no events, and runs started before it resume from that copy.

## 0.338.0

### billing-foundation

**SubscriptionProviderPlugin.cancelSubscription takes { providerSubscriptionId, when }**

`cancelSubscription(ctx, { providerSubscriptionId, when })` replaces the positional `providerSubscriptionId` argument. `when` is `SubscriptionCancelTimings.periodEnd` (`"period-end"`, the subscription runs to the end of the paid period) or `SubscriptionCancelTimings.immediately` (`"immediately"`). `createCheckoutSession` options gain optional `consentId`, `locale` and `submitMessage`; `SubscriptionEvent` and `PaymentEvent` gain an optional `consentId`, validated by `parseProviderConsentId` (max 100 characters of `A-Z a-z 0-9 _ -`), and `subscription` / `payment` event payloads store it.

**Migration:** Custom provider plugins that implement `cancelSubscription` change the signature to `(ctx, { providerSubscriptionId, when })` and honor `when`. A provider that can only cancel immediately may treat both values the same or leave the method out. Callers pass `{ providerSubscriptionId, when: SubscriptionCancelTimings.immediately }` to keep the old behavior.

**Remove rawPayload from provider events and event headers**

`rawPayload` is removed from `SubscriptionEvent`, `PaymentEvent`, `ProviderSubscriptionSnapshot`, the `process-event` and `process-payment-event` schemas and `SubscriptionEventHeaders` / `PaymentEventHeaders`. New events carry `providerEventId` and `providerName` in their headers; payment events also carry the optional `providerCheckoutId` (Stripe checkout session id).

**Migration:** Custom subscription provider plugins must stop returning `rawPayload`; TypeScript flags the removed field. Code that read the checkout session id out of `headers.rawPayload` reads `headers.providerCheckoutId` instead. Events already stored keep their old `rawPayload` header; this release does not rewrite stored events.

### cap-overview

**caps:usage and my-caps default to admin roles; widen with usageVisibleTo**

`createCapOverviewFeature` gets `usageVisibleTo?: readonly string[]`. Without it, the `caps:usage` query and the `my-caps` screen accept `access.admin` (TenantAdmin, Admin, SystemAdmin) instead of every tenant member. The screen and the query share the resolved roles. Only built-in roles are accepted (User, Member, Editor, Admin, TenantAdmin, SystemAdmin); an unknown or empty list throws at feature definition. The SystemAdmin `tenantId` override and the platform-wide screens are unchanged. The `MY_CAPS_ACCESS_ROLES` export is replaced by `DEFAULT_CAP_USAGE_ROLES` (the admin default), and `myCapsScreen` by `createMyCapsScreen(roles)`.

**Migration:** Apps whose regular members should keep seeing their usage pass `createCapOverviewFeature({ ..., usageVisibleTo: ["User", "Editor", "Admin", "TenantAdmin", "SystemAdmin"] })`. Code that imported `MY_CAPS_ACCESS_ROLES` (handlers or nav entries mirroring the screen rule) imports `DEFAULT_CAP_USAGE_ROLES` for the admin default, or reuses the same `usageVisibleTo` array it passed to the feature.

### framework-core

**searchable text fields must not declare a restricted access.read**

Boot validation rejects a text field that is `searchable` (or `find: "fuzzy"`) and also has a restricted `access.read`. The search index is not filtered per role, so search matches leaked the value to roles that cannot read the field.

**Migration:** Remove `searchable` / `find: "fuzzy"` from the field, or remove the read restriction. Write-only `access.write` restrictions are unaffected.

**signature routes with a :param segment or wildcard must not match framework paths**

Boot validation rejects `entry: "signature"` extra routes whose pattern, including `:param` segments, matches a framework path such as `/api/write`. Such a route skipped the JWT, origin and CSRF guards for that path.

**Migration:** Give the route a static prefix, for example `/api/webhooks/:provider` instead of `/api/:provider` or `/:provider/write`.

### tags

**ownership.write applies to assign-tag, remove-tag and add-note**

tags and notes-history: `ownership.write` is now enforced by `assign-tag`, `remove-tag` and `add-note`. Each feature instance builds its write executor from the entity it registers; before, the handlers used a module-level executor without the mount's ownership, so a `from()` write rule never applied to them. The `delete-tag` cascade stays ungated.

**Migration:** Mounts that set `ownership.write` now see ownership_denied for callers the rule does not cover. Make sure the rule covers every role that tags or notes, or leave it unset.

## 0.337.0

### @cosmicdrift/kumiko-renderer

**DataTableRowGrouping.headerLabel may return undefined**

`DataTableRowGrouping.headerLabel` returns `string | undefined`. `undefined` means the group has no header: the default web DataTable renders its rows without a header row and never collapses them.

**Migration:** Custom DataTable primitives that render `rowGrouping` handle `undefined` from `headerLabel` by rendering the group's rows without a header.

### framework-core

**Anonymous callers on protected handlers get 401 unauthenticated, and a stale auth cookie no longer blocks public handlers**

**Migration:** Tests or clients that expect 403 / access_denied for an anonymous caller (no session, the anonymousAccess user, or a JWT carrying only the anonymous role) on a role-gated or openToAll handler now get 401 / unauthenticated; update those assertions. Signed-in callers without the role still get 403 access_denied. With anonymousAccess wired, a request whose auth cookie fails verification or whose session is no longer live continues as anonymous outside /api/auth/* (public handlers answer 200, protected ones 401 unauthenticated) instead of failing with 401 invalid_token / session_invalid; bearer tokens and /api/auth/* keep the explicit 401.

**buildServer refuses partially wired session callbacks**

**Migration:** If you call buildServer with auth.sessionCreator or auth.sessionRevoker, also wire the other two of sessionCreator, sessionRevoker and sessionChecker (the sessions feature's sessionStore provides all three; runProdApp and runDevApp already do this). Without a sessionChecker a logout never invalidated the JWT. A sessionChecker alone stays allowed.

### secrets

**secrets:set and secrets:delete accept only keys declared via r.secret; r.secret takes writeRoles**

Both handlers reject a key that no feature declared with `r.secret` (404, i18n key `secrets.errors.unknownKey`). `r.secret` takes `writeRoles`: when set, only users holding one of those roles may set or delete that key (403, i18n key `secrets.errors.writeDenied`). The roles narrow the handler access, so both checks must pass. An empty `writeRoles` array throws at declaration.

**Migration:** Declare every key you set through `secrets:write:set` via `r.secret`. Rows stored under undeclared keys stay in the table but can no longer be set or deleted through the API. A key that only SystemAdmin may write declares `writeRoles: ["SystemAdmin"]`, and the secrets feature must then grant SystemAdmin handler access via `createSecretsFeature({ roles: ["TenantAdmin", "SystemAdmin"] })`. Tests that set a key no feature declares need the same fix: the kumiko-studio test `bundled-stack.integration.test.ts` sets `ai-foundation:secret:anthropic-api-key`, which no feature declares; kumiko-ai-foundation 0.39.1 and 0.40.1 declare the Anthropic key as `ai-provider-anthropic:secret:anthropic-api-key`.

## 0.336.0

### @cosmicdrift/kumiko-renderer

**LiveEvent data has no payload, it carries eventType**

`LiveEvent.data` is now `{ id, aggregateType, eventType, version, createdAt }`. The server sends signals only, so consumers refetch through a query.

**Migration:** Replace reads of `event.data.payload` with a query refetch. `useQuery({ live: true })` already does this and needs no change.

### framework-core

**/api/sse sends change signals without field values; anonymous connections only for declared entities**

The SSE broadcast consumer no longer puts the event payload (changes, previous) on the tenant channel, because that channel fans out to every tenant member and to anonymous connections. Entity frames carry `{ id, aggregateType, eventType, version, createdAt }`. Anonymous connections get entity signals only for entities named by an anonymously callable query via the new `liveEntities` option; the query name alone grants nothing, because a signal carries the id of every row, including rows the query filters out. Frames without an entity are delivered only when `data.userId` matches the connected user. Boot fails when `liveEntities` names an unregistered entity.

**Migration:** Code that reads `data.payload` from SSE frames must load the data with a query after the signal instead. Public pages that update anonymously add `liveEntities: ["<entity>"]` to the anonymous query they refetch (for example a `page:current` query), otherwise the live update stays off for anonymous visitors. `createSseRoute(broker)` now needs a second argument, `{ anonymousLiveEntities: collectAnonymousLiveEntities(registry) }`.

## 0.335.0

### @cosmicdrift/kumiko-renderer

**Wizard editing an existing record shows data-based done state and allows jumping to any step; delete record actions leave the screen**

Update-mode wizards compute done per step from the record (valid, non-empty fields, or passed via Next) and make every non-current step a jump target; forward jumps run the current step's validate gate. `ExtensionSectionProps.reportStepComplete` lets extension steps report completeness. `StepBar` gets `doneSteps` and `selectableSteps`. A writeHandler record action with `redirect`, or a delete of the shown record, navigates away (returnTo, redirect, listScreenId, entity list) instead of refetching.

**Migration:** Extension wizard steps in an entityEdit that edits an existing record should call `reportStepComplete(true)` (usually from an effect) once they hold their data, otherwise the step bar shows them as not done until the user passes them with Next. This also applies to singleton wizards (e.g. a company-setup wizard), whose steps now show done by data and are all jump targets; tests that assumed back-only chips must be updated. A delete writeHandler action on a projectionDetail or entityEdit now navigates away after success (returnTo, else listScreenId or the entity's list) instead of refetching into "record not found"; set `redirect` to choose another target. List row actions are unchanged.

### agent-tools

**Manifest rejects unknown denyQns, drops navs under hidden parents; doc lint flags blank and exposed-undescribed handlers**

Agent tools: `buildAgentManifest` now throws when `denyQns` names a handler that is not registered, so a typo can no longer leave a handler exposed. Navs whose parent is hidden from the role are dropped from the manifest, and screens reachable only through them are no longer listed. The agent doc lint reports handlers that are exposed without a description and treats a blank description as a gap.

**Migration:** `buildAgentManifest` now throws when `denyQns` names a handler that is not registered; remove stale or misspelled entries from your `denyQns` lists.

### billing-foundation

**Unregistered catalog.providerName fails unconfigured; switch-plan checks provider mismatch before lookup**

`billing-plans` now fails with an `unconfigured` error when `catalog.providerName` names a provider that is not registered, instead of rendering billing as disabled. Billing renders as disabled only when no `providerName` is set and no provider is mounted. `switch-plan` answers a subscription on an unmounted provider with the `providerMismatch` conflict instead of a 500.

**Migration:** If `catalog.providerName` names a provider that is not mounted, billing-plans now fails with `unconfigured` instead of rendering billing as disabled; mount the provider or remove `providerName`.

### cap-counter

**Cap helpers validate periodStartIso and amount, surface failed soft-warn writes; German column labels**

`bookCapUsage` and `markCapSoftWarned` now reject a `periodStartIso` that is not an ISO instant with a validation error instead of silently forking a counter row or throwing a `RangeError`. `enforceCap` rejects a non-integer or non-positive `amount` instead of letting it bypass the cap. `enforceCapAndMaybeNotify` surfaces a failed soft-warn write instead of re-sending the notification on the next call. The cap-counter list now has German column labels.

**Migration:** `bookCapUsage` and `markCapSoftWarned` now reject a `periodStartIso` that is not a full ISO instant, including date-only strings like `2026-10-01`; pass e.g. `2026-10-01T00:00:00.000Z`.

### config

**config:write:set masks the echoed value for encrypted-at-rest keys; validation errors no longer include the value**

**Migration:** A caller that reads `data.value` from a `config:write:set` result for a key with `encrypted: true` or `backing: "secrets"` now gets the mask. Use the value it sent instead. Tests that match the `value` param of a validation error on such a key need to drop that expectation.

### delivery

**Channel plugin guard validates mode and render**

Stricter input guards. A delivery channel plugin must declare `mode` as `inline` or `queued` and a function `render`, otherwise boot fails instead of silently dispatching inline. The derivatives-sharp overlay rejects a non-finite `marginPct` before it reaches sharp. A document-ingest provider can no longer register under the reserved name `unknown`, which marks upcast legacy ingest events. The unsubscribe POST route also accepts a JSON body.

**Migration:** A delivery channel plugin must now declare `mode` as `"inline"` or `"queued"` and a function `render`; boot fails otherwise instead of dispatching inline.

### document-ingest-foundation

**Provider name "unknown" is reserved for upcast legacy events**

**Migration:** Registering a document-ingest provider under the name `unknown` now throws; rename any provider that uses it.

### framework-core

**Boot rejects multiple principalStatus providers, updateMany rejects unknown columns again**

Several fail-loud fixes. `buildServer` now also rejects more than one `principalStatus` provider when `auth.membershipQuery` is registered (previously every login 500ed at runtime). `updateMany` throws again on a key that is not a column, and the replay of historical update events skips fields removed from the entity instead. `lt`/`gt`/`lte`/`gte`/`like` on a jsonb column match nothing in the where builder, like the event-store read path.

**Migration:** `updateMany` now throws when `set` or `where` contains a key that is not a column of the table; remove such keys from your calls. Replay of historical update events still skips removed fields.

**AgentReasons.permissionDenied removed**

**Migration:** Drop references to `AgentReasons.permissionDenied` / `"agent.permission_denied"`. The framework never emitted this reason.

**FileRef type drops the unreachable isDeleted field**

The exported `FileRef` type no longer carries `isDeleted`. Soft-deleted rows were already filtered out before the guard sees a file, so the field was never reachable. Custom file access guards that read `fileRef.isDeleted` must drop that check.

**Migration:** Remove reads of `fileRef.isDeleted` in custom file access guards; soft-deleted rows never reach the guard.

**File content check covers csv alias, local list scoped to prefix, provider contract checked, locale tags canonicalized**

File storage and locale hardening. `validateFileContent` now rejects binary bytes for an extension with a declared-MIME alias (a real `.xls` renamed to `.csv`), so custom upload routes using `validateFile` + `validateFileContent` are covered. `tenantExportPrefix` and `tenantStoragePrefixes` throw for a tenant id equal to the reserved `exports` segment. The local provider's `list()` only walks the prefix directory instead of the whole storage root. A file-provider plugin whose built provider lacks a required method now fails loudly at resolve time. `canonicalizeLocaleTag` normalizes region and script subtags (`de-AT`, `zh-Hant-TW`), so `X-Locale: DE-at` finds a `de-AT` mail registration.

**Migration:** A file-provider plugin whose built provider lacks a required method now throws at resolve time; make sure custom file providers implement the full provider interface.

**Global-table tenant writes reject loudly, restore maps unique violations, managed unique-index changes recreate**

Tenant-mode `updateMany`/`deleteMany` on a `tenancy: "global"` table now reject with an `AccessDeniedError` pointing at `db.global(table)` instead of silently matching zero rows. `restore` on a soft-deleted row whose unique value was re-used now returns a 409 `unique_violation` instead of a raw 500. The migration generator now recreates a managed projection when an existing index becomes unique, changes columns or widens its WHERE.

**Migration:** Tenant-mode `updateMany`/`deleteMany` on a `tenancy: "global"` table now throws instead of matching zero rows; switch those calls to `db.global(table)`.

**i18n key guard covers multiSelect option labels and writeForm section descriptions**

The i18n key guard now requires translations for filterable `multiSelect` option labels and for the `description` of a `projectionDetail` writeForm section. Missing translations used to fall back silently; they now fail the guard.

**Migration:** The i18n required-surface-keys check now requires translations for filterable `multiSelect` option labels and `projectionDetail` writeForm section descriptions; add the missing keys to your locale files.

**totalsMatch rejects a payload that carries only one side of the pair**

A `totalsMatch` pair is now validated as a unit. A payload that carries only the embedded list or only its sibling money field is rejected with a validation error, because update payloads only carry `changes` and the sum could otherwise drift away from the total.

**Migration:** Send the embedded list and its sibling money field together in every create and update payload. A partial update that changes only `total` or only the list now fails validation.

### jobs

**Job runner keeps retry budget on sequential lock conflicts, names the error without a db, fails loudly on bad tenantVisibleFailure subjects, stamps the raw feature name; jobs list filters multi-status**

Job runner hardening. A job run now stamps its event `metadata.feature` with the feature's raw name, the same value write-handlers stamp (previously the kebab-case form for camelCase features). On a runner built without a db, touching `ctx.db` in a job throws a named error instead of a `TypeError`. A non-primitive `tenantVisibleFailure.subjectFields` value now fails the run visibly (run row, `onJobFailed`) and is not retried. A failing last-success metric no longer fails a successful run, and the runner registers the standard metrics on its meter itself. A sequential job whose retry attempt hits a held lock keeps its remaining retry budget instead of getting a fresh one. `stop()` waits at most 1 second for queue readiness. A custom `tenant:query:active-tenant-ids` handler returning anything but `string[]` is rejected. `Registry` gains `getJobFeature`.
In the jobs feature, a failing tenant-failure record write no longer blocks the run-row update or fails a completed run, `jobs:query:list` honours multi-value status filters and rejects filters on unknown fields, and `jobs:write:retry` answers 422 for a payload that is still ciphertext because no KMS is configured.

**Migration:** Events written by a job of a camelCase feature now carry metadata.feature with the raw feature name (for example "pubSubOrders") instead of the kebab-case form; update any audit or metrics filter that matched the kebab-case value. Custom Registry implementations must add getJobFeature(qualifiedJobName). A jobs:query:list call with filters on a field other than status is now rejected.

### secrets

**createSecretsFeature rejects access and roles together**

`createSecretsFeature` throws at mount when both `access` and `roles` are passed; `access` used to silently discard `roles`. The personal-access-token mint form builds its i18n keys from the shared key helpers, and `ACTION_FORM_ENTITY` is now exported from `@cosmicdrift/kumiko-framework/ui-types`. The rate-limiting feature registers de/en copy for its error keys.

**Migration:** Remove `roles` from the `createSecretsFeature` options when `access` is set (or drop `access` and keep `roles`). Before, `roles` was silently ignored next to `access`.

### subscription-mollie

**Mollie one-off prices no longer need an interval; a subscription price without one is rejected**

`MolliePriceConfig.interval` is now optional so one-off prices (credit top-ups, `mode: "payment"`) no longer need a dummy interval. A price without `interval` booked as a subscription now fails at checkout creation, and a paid first payment for such a price creates no Mollie subscription (a warning is logged). The "checkout url is null" error no longer blames first-payment mandates for one-off payments.

**Migration:** Mollie checkout creation now throws for a subscription price without `interval`; set `interval` on every subscription price (one-off `mode: "payment"` prices need none).

### template-resolver

**TemplateResource and text-block/collection query outputs expose modifiedAt instead of updatedAt**

Review round 2 fixes across the feature AST, codemods, the template-resolver and the renderer router.
- feature-ast: handler lookup falls back to the header when the body carries no match, a `zod` namespace import (`import * as z`) is recognised, and patch edits no longer overlap.
- Codemods: the PII heuristic matches segment-aligned names, the open-to-all codemod sets its exit code, and `failUnprocessable` calls are migrated.
- template-resolver: the row types and the public output now use the real base columns. `by-slug`, `by-tenant`, `list`, `find-by-id` and the `TemplateResource` API return `modifiedAt` (null until the first edit) instead of `updatedAt`, which was always undefined at runtime. The user-content export reads `modifiedAt` too.
- renderer: `formatPath` and `parsePath` encode and decode every path segment, so an entity id like `foo/bar` or `ä b` survives a round trip. A malformed percent-escape in the URL resolves to no route.

**Migration:** Rename reads of `updatedAt` to `modifiedAt` on TemplateResource, the by-slug, by-tenant, list, find-by-id and collection queries, and the template-resolver web BlockSummary. The old field was never populated at runtime; the new one is an ISO timestamp, or null for a row that was never edited.

## 0.334.0

### framework-core

**Duplicate write/query handler names in one feature fail at definition time**

**Migration:** Rename a custom handler that shares its name with another handler of the same feature, including names r.crud registers (<entity>:list, <entity>:detail, <entity>:create, <entity>:update, <entity>:delete, <entity>:restore). Before, the later registration replaced the earlier one silently.

## 0.332.0

### framework-core

**buildInsertSchema strips id again; caller-chosen ids need { allowCallerId: true }**

**Migration:** Custom-Create-Handler, die eine caller-gewaehlte id brauchen, uebergeben { allowCallerId: true } und erlauben sie nur System-Identities.

**ctx.fetchForWriting scopes handle.events to the aggregateType since the #2979 release (correction, not purely additive)**

The #2979 changeset described the `aggregateType` filter as "purely additive". For `ctx.fetchForWriting` that was wrong: since that release, `handle.events` only contains events of the fetched aggregateType, even when a handler never passed an `aggregateType` option. Events of another aggregateType on the same aggregateId are no longer part of the handle. `loadAggregate` without `aggregateType` is unchanged.

**Migration:** handle.events von ctx.fetchForWriting ist seit Einführung des aggregateType-Filters
typ-gescoped; Handler prüfen, die Events eines anderen aggregateType auf derselben
aggregateId erwartet haben, und diese per loadAggregate ohne aggregateType lesen.

## 0.330.1

### @cosmicdrift/kumiko-renderer

**Boolean fields in flow forms use FieldCellWidth "toggle" instead of "auto"**

In flow forms (screen forms and drawers) a boolean field's label now shares the top line with its neighbours' labels and the switch sits on the input line. The `FieldCellWidth` union loses `"auto"` and gains `"toggle"`; the default web Grid maps it to a fixed minimum width.

**Migration:** Custom Grid/GridCell primitives keyed by FieldCellWidth: rename `auto` to `toggle`.

## 0.330.0

### @cosmicdrift/kumiko-locale-de

**locale-de and locale-es drop 110 keys that no framework feature registers any more (old custom-screen keys such as audit.log.*, jobs.runs.*, userDataRights.privacyCenter.title)**

The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

**Migration:** The framework no longer renders these keys, so framework screens are unaffected. If app code or an app test calls t() with one of them, register that key in the app's own translations or switch to the key the framework screen uses now (for example the screen title key screen:<screen-id>.title, as in screen:audit-log.title).

### @cosmicdrift/kumiko-locale-es

**locale-es drops the same keys that no framework feature registers any more**

The new i18n-parity test in `use-all-bundled` harvests the English copy from the real registrations (feature translations, client plugins, renderer defaults, mail templates) and fails with `key -> locale` when `locale-de` or `locale-es` lacks a key or an en-catalog drifts. This added the missing German and Spanish copy for billing plans, the privacy-center status field and many more keys, and removed 110 translation keys no feature registers any more. German uses "Ereignisprotokoll" for the audit log everywhere. `userDataRights.privacyCenter.restriction.dialogTitle` and `.deletion.dialogTitle` are registered in English by the feature.

**Migration:** Same as locale-de: register any removed key your app still calls in the app's own translations, or switch to the key the framework screen uses now.

### admin-shell

**admin-shell requires the metrics and metrics-system features and builds its overview dashboards from a metrics list**

Dashboard panels gain the chart kinds `stacked-bars`, `segment-bars` and `stacked-area`, a subtitle, per-series tones, static query `params`, `ignoreScreenFilter`, an empty label and hint, a `span` (half/full width), a stat `sparklineField` and static `tone`, a `negative` tone, an unlabelled `stat-group` KPI strip and bar/badge list columns. Every panel shows skeleton, empty and error states with retry. A screen can declare a `timeRange` control and a `scope` badge and notice. The admin-shell overview screens use all of this and show the metrics of the new `metrics` and `metrics-system` features. `deliveries-by-channel` now labels the email, in-app and push channels.

**Migration:** Mount createMetricsFeature({ metrics: DEFAULT_METRICS }) and createSystemMetricsFeature({ metrics: DEFAULT_METRICS }) from the metrics bundled feature before admin-shell. DEFAULT_METRICS also requires the delivery, sessions, jobs and tenant features.

If you do not mount all of them, pass the same reduced list to all three: createMetricsFeature({ metrics }), createSystemMetricsFeature({ metrics }) and createAdminShellFeature({ metrics }). Overview panels exist only for metric ids in that list.

## 0.328.0

### @cosmicdrift/kumiko-renderer

**Screens fill the shell height by default**

entityList, projectionList, projectionDetail, entityEdit, actionForm and wizard screens now fill the height of the shell content. The table or the form body scrolls inside, the toolbar stays on top and the pager or action bar stays pinned at the bottom (`scrollBody`, `stickyActions`). The shell header is 56px. Custom screens and direct DataTable or Form usage are unchanged.

**Migration:** Set `fillHeight: false` on a screen to restore the old page scrolling (table grows with its rows, pager below the last row, form footer in the flow). Apps with e2e or screenshot tests that scroll the page to reach the pager or the form footer need to adjust them or opt out per screen.

**Pager shows a status line, page size select and Page X of Y instead of page numbers**

The numbered page list is gone. The list footer shows "1-19 of 19 <entities>" (with the entity plural label when known), "Page X of Y", previous and next buttons and a page size select (25, 50, 100). Lists without a pager show a plain entry count. The chosen size is kept in the URL under `<screen>.size`.

**Migration:** Remove code and tests that click numbered page buttons (`-page-N` test ids); use the next and previous buttons. The screen's declared `pageSize` stays the default, `<screen>.size` in the URL overrides it. The new keys `kumiko.pager.pageOf`, `kumiko.pager.status.noun`, `kumiko.pager.pageSize`, `kumiko.pager.pageSizeLabel`, `kumiko.list.count.*` exist in en, de and es; apps with their own locale need them too.

**rowActionMode adaptive has new semantics and mobile rows lose the kebab for plain navigation**

With `rowActionMode: "adaptive"` (the default), a table with `onRowClick` renders the first cell as a keyboard-operable link and puts all row actions into the kebab. Without `onRowClick` the primary row action is a link-button and the remaining actions go into the kebab (a single action gets no kebab). Below the md breakpoint a row that only navigates shows a chevron and no kebab.

**Migration:** Code or tests that expect up to two inline row action buttons must open the kebab or use `rowActionMode: "inline"`, which is unchanged. To keep a visible action next to the row link, drop `onRowClick` and declare the action as the primary row action.

**Form, wizard and detail screens use the board layout**

Screen forms have no card, sections are separated by lines, fields flow in rows with widths by type (text 240px, number 96px, money 160px, date and select 200px, textarea full row) and the page title lives in the shell header. Delete and Copy link move into the header kebab, the footer reads status, Cancel, Save, and the wizard footer has no Cancel. Wizard steps sit in a vertical rail from the lg breakpoint. The first detail header action is a button, further ones sit in the kebab. Detail screens have no header card and use the full width: metrics render as a dl band, tabs are underlined only when active, related lists are full-bleed with a count footer. Required-field asterisks are omitted when every field is required and "All fields are required." is shown instead.

**Migration:** Adjust screenshots and DOM tests that pin the old card layout. `fillHeight: false` restores page scrolling only; the footer order, the moved actions and the new field layout apply in both modes. Empty list cells render a dash.

## 0.327.0

### step-dispatcher

**step.dispatch-requested payloads are flat and crypto-shredded; kumiko:system:* events have a declared PII stance**

**Migration:** No code change is needed for r.step.mail.send / r.step.webhook.send callers. The step.dispatch-requested payload changed from a nested `spec` object to flat fields (mail.send: to as JSON string, subject, body, from; webhook.send: url, method, headersJson, bodyJson, auth, retry). With a subject KMS configured, those fields are encrypted under a per-dispatch record key (record:step-dispatch:<aggregateId>) that the step-dispatcher erases once the outcome is recorded (Art. 17 via crypto-shredding). There is no legacy branch: a dispatch-requested event still in flight at upgrade (old nested shape) ends as step.dispatch-failed with error "invalid dispatch payload", so drain the queue before deploying or accept the one-time failed event. Webhook delivery errors no longer echo the URL or the raw request error. mail.send delivery errors are recorded as a generic "mail delivery failed"; the adapter's raw error goes to the step-dispatcher log. Code reading dispatch-requested payloads directly must switch to the flat shape. A new kumiko:system:* event type must be added to SYSTEM_EVENT_PII_STANCES (crypto/system-event-pii.ts); encryptEventPayloadPii throws for an undeclared system type. SYSTEM_EVENT_PREFIX and AGGREGATE_TRANSFERRED_EVENT_TYPE now live in crypto/system-event-pii.ts, and the STEP_DISPATCH_* constants are exported from @cosmicdrift/kumiko-framework/engine instead of engine/steps/webhook-send.

### workflow-runner

**Workflow run-failed and retry.scheduled events store a generic error text instead of the raw error**

**Migration:** The `error` field of workflow.run-failed and workflow.retry.scheduled events is now generic, "workflow step failed (<error class>)" (or "(unknown error)" for non-Error throwables), because the raw text can contain recipients or payload fragments and would survive an erase. The raw error goes to the log (namespace workflow-runner, and the framework logger for retry). Code that parses the `error` text must switch to `reason` (machine-readable, set for definition changes) or to the logs. Already stored events keep their old text. The texts for an unregistered workflow and a definition-fingerprint mismatch are unchanged. describeWorkflowStepError is exported from @cosmicdrift/kumiko-framework/engine.

## 0.326.0

### config

**Extension-selector settings render as one tenant screen**

BREAKING: an extension-selector key now renders as a select of the mounted plugin ids, and
`config:write:set` rejects every value except a mounted plugin id or "" with 422
`config.errors.unknownExtensionPlugin`.

The owner's tenant screen `<owner>-tenant` is now a dashboard; its former configEdit moved
to `<owner>-tenant-selection`. Plugin features under a masked selector lose their tenant nav
entry: their `<plugin>-tenant` screen stays as a nav-less embedded panel (a direct deep link
still resolves), and their secrets move from the global `secrets` screen into
`<plugin>-tenant-secrets` panels. A plugin feature registered under more than one selector
registration keeps the previous behaviour.

Generated hub screens need the new key `config.settings.extensionSelectorHint` (shipped in
the config and secrets bundles, en/de/es).

**Migration:** Links, tests or screenshots that open `<plugin>-tenant` through the nav or expect a configEdit
at `<owner>-tenant` should open `<owner>-tenant` (now the dashboard) and look for the plugin
panels there. Tenant rows or scripts that write a selector value naming no mounted plugin must
write a mounted plugin id or "" instead. No new translation keys are required from apps.

## 0.324.0

### framework-core

**Writes on readAsInstruction fields now require agent.risk "high" on the directly-dispatched handler**

**Migration:** New field flag `readAsInstruction: true` on `text`, `longText`, and `jsonb`
fields (`@cosmicdrift/kumiko-types`) marks a field whose value a later run
reads as an instruction — a prompt, rule, or template. Any create/update
whose payload writes such a field must resolve `agent.risk: "high"` on the
directly-dispatched entry handler, or the executor gate denies it with
`access_denied` / `instruction_field_write_requires_high_risk` before any
DB write. This is opt-in per field, but touches every write path once a
field carries the flag — consumer checklist:

1. Mark fields that a later run reads as an instruction (prompts, rules,
   templates) with `readAsInstruction: true`.
2. Update your own handlers that write such a field via
   `executor.create`/`executor.update`, or delegate into one via
   `ctx.write`/`writeAs`, to `agent: { risk: "high" }` — the directly
   called handler must carry it, delegation does not inherit it.
3. Standard entity-convention create/update handlers on an entity with such
   a field now default to "high" automatically; declaring a lower
   `agent.risk` on one is a define-time error, same as the delete floor
   from #3345.
4. An update whose payload doesn't include the flagged field stays allowed
   unchanged — the gate checks payload presence after `preSave`, not
   whether the value actually changed.
5. Not gated: `delete`/`restore` (they don't write the field; the existing
   irreversible-delete floor still applies), and your own domain events
   applied via `ctx.appendEvent` whose projection writes a flagged field —
   route such writes through the executor primitives (`create`/`update`)
   to get the gate.
6. On `create`, a flagged field with a `default` counts as written even if
   the payload omits it — `applyDefaults` runs before the gate. A custom
   mid-risk create handler whose payload leaves the field out is denied
   just the same, and a standard create with `excludeFields` on such a
   field still resolves to "high".

## 0.323.0

### @cosmicdrift/kumiko-dev-server

**kumiko-build reads client entries from package.json "kumiko.clientEntries"/"kumiko.clientEntry" instead of inferring them from filenames**

`kumiko-build` (and the `kumiko build` command) now call
`readClientEntriesConfig(cwd)` and pass the result into
`buildProdBundle`, instead of relying on `discoverClientEntries`'
filename-based multi-entry discovery. `@cosmicdrift/kumiko-dev-server/build`
re-exports `resolveClientEntries`, `readClientEntriesConfig`, and
`ClientEntryDeclaration` in place of `discoverClientEntries`.

**Migration:** See the `@cosmicdrift/kumiko-server-runtime` changelog entry above for
the required package.json changes — the dev-server change is the CLI
wiring for the same underlying behavior.

### @cosmicdrift/kumiko-server-runtime

**buildProdBundle takes client entries explicitly via package.json "kumiko.clientEntries"/"kumiko.clientEntry" — no more filename inference**

`discoverClientEntries(cwd)`, which scanned `src/` for
`client-<suffix>.tsx` files and treated every match as its own bundle
entry, is replaced by `resolveClientEntries(cwd, declared)` plus
`readClientEntriesConfig(cwd)`, a boundary parser for package.json
`kumiko.clientEntry` / `kumiko.clientEntries`. `buildProdBundle(options)`
now accepts the same `clientEntry`/`clientEntries` shape directly.

`kumiko.clientEntries` entries are validated: `name` must match
`^[a-z][a-z0-9-]*$` (it becomes the output filename), `sourceFile` (and
`htmlPath`, if set) must resolve inside the app root, `sourceFile` must
exist, and names/html-output-files/source-basenames must be unique
across the list. `clientEntry` and `clientEntries` are mutually
exclusive; an empty `clientEntries` array is rejected (omit the key
instead). Apps with only `src/client.tsx` or `src/client.ts` need no
declaration — that convention is unchanged.

**Migration:** Apps with `src/client-<name>.tsx` entries: add the entry list to
package.json, using the same objects already passed to
`runDevApp`/`createKumikoServer`'s `clientEntries` (paths relative to the
app root). Without this, the build now throws instead of silently
building without those bundles.

  publicstatus:

    "kumiko": {
      "clientEntries": [
        { "name": "public", "sourceFile": "./src/client-public.tsx" },
        { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
        { "name": "auth", "sourceFile": "./src/client-auth.tsx", "htmlPath": "./public/auth.html" }
      ]
    }

  show-pony:

    "kumiko": {
      "clientEntries": [
        { "name": "admin", "sourceFile": "./src/client-admin.tsx", "htmlPath": "./public/admin.html" },
        { "name": "public", "sourceFile": "./src/client-public.tsx", "htmlPath": "./public/index.html" }
      ]
    }

  offlot-app:

    "kumiko": {
      "clientEntries": [
        { "name": "app", "sourceFile": "./src/client-app.tsx", "htmlPath": "./public/app.html" }
      ]
    }

Apps using a single entry that isn't `src/client.tsx`: add
`"kumiko": { "clientEntry": "./src/…" }` instead.

Apps with only `src/client.tsx` | `src/client.ts`: no action needed.

`discoverClientEntries` (exported from
`@cosmicdrift/kumiko-dev-server/build`) is removed; callers use
`resolveClientEntries(cwd, readClientEntriesConfig(cwd))`.

### framework-core

**createTextField/createLongTextField require an explicit personal-data stance**

Both factories' `overrides` parameter is no longer optional and must
include a `personal` stance:
`{ personal: "self", find: "exact" | "fuzzy" | "none" | "secret" }`
(longText: `find: "none" | "secret"`), `{ personal: "tenant", find: … }`,
`{ personal: { of: "<ownerField>" }, find: … }`, `{ personal: "ref" }`, or
`{ personal: false, reason: "<why this is not personal data>" }`. A
missing/malformed shape throws at the call site (`createTextField(...)` /
`createLongTextField(...)` in the message, with every valid option
listed) instead of silently resolving to an unannotated field — this
also removes the #2918 boot-time deprecation warning, since the shape it
warned about can no longer be constructed.

**Migration:** Two call forms now throw: `createTextField()` / `createLongTextField()`
with no argument at all, and an options object with no `personal` key,
e.g. `createTextField({ required: true })`. Add a stance to every call:

  createTextField({ personal: "self", find: "exact" })
  createTextField({ personal: "tenant", find: "none" })
  createTextField({ personal: { of: "authorId" }, find: "none" })
  createTextField({ personal: "ref" })
  createTextField({ personal: false, reason: "is_business_data" })

`personal: false` additionally requires a non-empty `reason` string.
`find` is mandatory whenever `personal` names a subject (`"self"` /
`"tenant"` / `{ of }`) — not for `"ref"` or `false`. The #2918 boot-time
deprecation warning for this shape is gone; there's nothing left for it
to warn about.

To find remaining call sites (the #2919 codemod mode below is the
migration tool): `kumiko-guards guards
--guard="Text-Field Personal-Stance Guard"` flags every
statically-decidable call missing a stance. `bun
node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/pii-personal-migration.ts
<targetDir> --report-stance` classifies unannotated text/longText fields
by name heuristic (direct/user-owned/user-reference/near-miss/
unclassified) to help pick the right stance — it does not add one
automatically, since a wrong guess would be worse than the throw. This
codemod is not wired into `kumiko upgrade --apply`; run it by hand. It
also only transforms fields still carrying the OLD flag-based API
(`pii`/`userOwned`/`tenantOwned`/`subjectRef`/`allowPlaintext`) — a field
with no annotation at all was never in its mapping table and needs a
stance added by hand either way.

## 0.322.0

### framework-core

**Irreversible writes now require agent.risk "high" on the directly-dispatched handler**

**Migration:** Any write handler reachable as the directly-dispatched entry point that
performs `executor.forget()` (any entity) or `executor.delete()` on an
entity without `softDelete` must resolve `agent.risk: "high"`, or the
executor gate now denies it with `access_denied` /
`irreversible_operation_requires_high_risk` before any DB read.

Three breaking changes ship together:
1. Add `agent: { risk: "high" }` to your own write handler if it directly
   runs `forget` or a hard `delete` on a non-softDelete entity.
2. Delegating via `ctx.write`/`ctx.writeAs` from a lower-risk handler into
   a high-risk forget/hard-delete handler no longer inherits the inner
   handler's risk — the outermost/entry handler's declared risk governs,
   so the delegating handler itself must be "high".
3. Declaring `agent.risk` below "high" on a standard entity-convention
   delete handler for a non-softDelete entity is now a define-time/boot
   error instead of a silently-accepted setting.

Standard entity-convention delete handlers on a non-softDelete entity now
default to "high" automatically (no more implicit "always allow").

`dispatchToolCall` treats the invoked tool itself as the entry handler,
not the surrounding turn/approve write handler that dispatched it — a
mid-risk "approve" handler can safely invoke a high-risk tool directly,
but a mid-risk tool that itself delegates to a high-risk handler via
`ctx.write`/`writeAs` is still denied per rule 2.

`runAsDirectCallEntry` (framework `/api`) is the one sanctioned entry
boundary: it clears the entry handler so the next dispatch counts as the
directly called one. `dispatchToolCall` uses it because the human
confirmation happens in approve; do not use it to lift a handler past
the floor.

Remaining gap: `afterCommit` hooks, jobs, and event consumers are not
gated by this floor — they have no directly-dispatched entry handler to
attribute risk to.

## 0.321.0

### billing-foundation

**switch-plan rejects a subscription with a scheduled cancellation**

`billing-foundation:write:switch-plan` now throws a `409 ConflictError`
(`billing-foundation.errors.cancellationScheduled`) when the tenant's
subscription already has `cancelAt` set — switching plans mid-cancellation
previously silently proceeded and could leave the new plan itself
scheduled to cancel. `billing-foundation:query:billing-plans` now resolves every
non-current plan's `action` to `unavailable` (instead of `switch`) while a
cancellation is scheduled, and the billing-plans panel shows a
`switchRequiresReactivation` message alongside the existing
`cancelScheduled` banner.

**Migration:** A tenant that switches plans while their subscription is scheduled to
cancel now gets a 409 instead of a successful switch. Callers driving
`switch-plan` directly (not through the bundled panel) must reactivate the
subscription first (`create-portal-session` / the provider's own
reactivation flow) before retrying the switch.

### delivery

**Unsubscribe route splits into a non-writing GET confirmation page and a writing POST (RFC 8058)**

`createUnsubscribeRoute({ secret })`, which mounted a single `GET` route
that wrote the opt-out as a side effect of the request, is replaced by
`createUnsubscribeRoutes({ secret })`, which returns both routes for the
same path: `GET` renders a confirmation page (`<form method="post">`) and
performs no write; `POST` performs the write, reading the token from a
form-urlencoded body first, then the query string as a fallback (so an
RFC-8058 one-click client that POSTs `token=` only in the URL still works).
Token verification and error mapping (`400 unsubscribe_token_invalid`) are
unchanged and shared between both routes.

**Migration:** Replace `extraRoutes: [createUnsubscribeRoute({ secret })]` with
`extraRoutes: [...createUnsubscribeRoutes({ secret })]`.

Unsubscribe links already mailed out before this upgrade now show a
confirmation page on click instead of unsubscribing immediately — the
recipient must submit the form (or a one-click mail client must POST) to
complete the opt-out. If the app rendered its own confirmation page in
front of the old GET link, it can be removed; the framework route now
covers that step.

### framework-core

**webhook.send step auth secretRef renamed to secret; MultiStreamApplyContext gained an optional secrets field**

`r.step.webhook.send`'s `auth` union renamed `secretRef` → `secret` (see
the step-dispatcher entry for the full rationale). `MultiStreamApplyContext`
(and `createMultiStreamApplyContext`'s deps) gained an optional
`secrets?: SecretsContext` field, mirroring `files`/`derivatives` — present
when the app booted with the secrets feature, letting a saga/process-
manager MSP apply read a tenant secret with its own audit context. The
server's MSP consumer wiring now threads the boot-time `AppContext.secrets`
through automatically; `rebuildMultiStreamProjection`'s rebuild context
deliberately does not carry `secrets` (rebuild must stay side-effect-free).

**Migration:** Rename `auth.secretRef` → `auth.secret` at every `r.step.webhook.send`
call site. No action needed for `MultiStreamApplyContext` consumers that
don't read `ctx.secrets` — the field is optional and additive.

### step-dispatcher

**Webhook auth secrets are now tenant-owned via the secrets feature, not a global env var**

`r.step.webhook.send`'s `auth` config renamed `secretRef` → `secret`. The
value is now a name inside the tenant-owned secrets namespace
`step-dispatcher:webhook-auth.<secret>` (secrets feature), resolved via
`SecretsContext.get()` at dispatch time with an audit read stamped with
the triggering event's userId (or the system actor for cron/resume
dispatches). `setWebhookSecretResolver` / the `WEBHOOK_SECRET_*` env
convention are gone. `performWebhookDispatch(spec)` now takes a required
second `deps: { tenantId, userId, secrets }` argument.

**Migration:** Mount `createSecretsFeature()` (with a `MasterKeyProvider`) alongside
`createStepDispatcherFeature()` — boot-validation now fails without it.
For each tenant that uses `r.step.webhook.send` with `auth`, set the
credential via `secrets:write:set` under
`step-dispatcher:webhook-auth.<secret>` (the same name passed as
`auth.secret`). Rename `auth.secretRef` → `auth.secret` at every
`r.step.webhook.send({ auth: {...} })` call site. Remove any
`WEBHOOK_SECRET_*` env vars — they're no longer read.

A `step.dispatch-requested` event already enqueued before this upgrade
(still carrying the old `secretRef` shape) fails validation on drain and
is recorded as `step.dispatch-failed` with `error: "invalid dispatch
payload"` instead of silently resolving a stale ref — drain the queue (or
accept the one-time failed event) before deploying.

Tests calling `performWebhookDispatch` directly or using
`setWebhookSecretResolver` must pass a `SecretsContext` (or `undefined`)
via the new `deps` argument instead.

## 0.320.0

### @cosmicdrift/kumiko-dev-server

**createKumikoServer/runDevApp gained a trustedProxyHops option**

`CreateKumikoServerOptions`/`RunDevAppOptions` gained a top-level
`trustedProxyHops`, forwarded into `setupTestStack`'s `buildServer` call.
Dev normally runs unproxied, so this is usually left unset (default 0).

**Migration:** No action needed for the default (unproxied) dev setup. Set
`trustedProxyHops` only if you run the dev server behind a reverse proxy.

**Dev-server HTML no longer injects __KUMIKO_SCHEMA__ either**

**Migration:** Same semantics as the prod change: `DevHostDispatchResult.injectSchema`
is deprecated and ignored. The dev-server's auto-mint mode still sets
the `kumiko_auth`/`kumiko_csrf` cookies on the HTML response, so a
client-side fetch to `/api/schema` is authenticated immediately without
a real login round-trip.

### @cosmicdrift/kumiko-server-runtime

**runProdApp threads the Bun socket address and a trustedProxyHops option through to the client-IP resolver**

`buildBunServeOptions` now extracts the client socket address once via
`server.requestIP(req)` at the outermost Bun.serve fetch callback (a
cloned/rebuilt Request loses that ability) and threads it through
`tryHonoFirst`/`withSecurityHeaders`/`buildStaticFallback` as Hono's
`env`. `RunProdAppOptions` gained a top-level `trustedProxyHops` (falls
back to the deprecated `auth.trustedProxyHops`, then
`KUMIKO_TRUSTED_PROXY_HOPS`), forwarded into `buildServer` and the
static-fallback's own client-IP resolver.

**Migration:** Same as the framework entry — set `trustedProxyHops` on `runProdApp` when
deployed behind a reverse-proxy/ingress.

**Static fallback no longer injects __KUMIKO_SCHEMA__ into HTML**

**Migration:** `HostDispatchResult.injectSchema` is deprecated and ignored — HTML never
carries the schema anymore, in prod or dev. `createKumikoApp` now fetches
the schema itself from the authenticated `GET /api/schema` after its
clientFeature gates (e.g. an auth gate) let rendering through, so a
signed-in admin app keeps working without changes. Anything that read
`window.__KUMIKO_SCHEMA__` directly (custom clients, e2e fixtures) must
switch to fetching `/api/schema` instead. An anonymously reachable page
that used to render schema-based screens needs `createPublicSurface`,
which never carries a schema. The `@cosmicdrift/kumiko-server-runtime/inject-schema`
subpath export is removed.

### framework-core

**Centralized client-IP resolver replaces the old first-XFF-entry heuristic**

New `trustedProxyHops` option on `ServerOptions` (default 0 — trusts no
proxy header, only the socket address counts). Precedence:
`options.trustedProxyHops ?? options.auth?.trustedProxyHops ?? 0`.
`requestContext.ip` is now always set for an HTTP request (falls back to
"unknown" instead of being left undefined), so `rateLimit: { per: "ip" }`
handlers reached via `r.httpRoute`/`extraRoutes` systemQuery are never
silently unthrottled. `rate-limit/middleware.ts`'s `globalIpRateLimit`/
`authEndpointRateLimit` and `auth-routes.ts`'s `createAuthRoutes` gained a
`trustedProxyHops`/`clientIpResolver` option and now share the server's
one resolver instance instead of each building their own.

**Migration:** Apps deployed behind a reverse-proxy/ingress that appends to
X-Forwarded-For must set `trustedProxyHops` (buildServer/runProdApp/
runDevApp top-level option) to the number of trusted hops — usually `1`
for a single ingress. Without it, every client collapses into one shared
rate-limit bucket (safe default, but likely too strict for real traffic).
Apps not behind a proxy need no change; `trustedProxyHops` defaults to 0.

Integration tests that call an `ip`/`ip+handler`-rate-limited handler
repeatedly through `stack.http.raw`/`stack.app.request` (no real socket)
now share one "unknown" bucket instead of skipping the bucket entirely —
a previously-passing test suite can start seeing 429s. Fix by flushing
the rate-limit namespace between test cases (`stack.redis.flushNamespace()`
in `beforeEach`), or by setting `setupTestStack({ trustedProxyHops: 1 })`
and sending a distinct `X-Forwarded-For` per test case. Also check any
test that nulls `context.redis` via `extraContext` to exercise a
handler's own redis-down guard: `setupTestStack` now keeps the L3
rate-limit resolver alive from its own always-real Redis in that case
(an explicit `context.rateLimit` still wins), so a handler-declared
`rateLimit` is enforced instead of throwing `InternalError` for a missing
resolver.

**Personal Access Tokens are now scoped to the dispatcher routes only**

**Migration:** A caller using a PAT for SSE, file upload/download, /api/auth/*, a feature
r.httpRoute, or an entry:"user" extraRoute now gets a 403 and needs a
session-cookie or JWT credential for those calls instead. The dispatcher
routes (/api/write, /api/batch, /api/query, /api/command, /api/stream) are
unaffected.

### inbound-provider-imap

**The tenant-configured IMAP host must resolve to a public address**

**Migration:** An operator relying on an internal IMAP server or a local dev/test server
(greenmail on localhost or a private IP) now gets an InboundAuthError
(account marked auth_error) unless that host is explicitly allowed. Set
the same operator env var mail-transport-smtp reads (comma-separated, no
boot-time code call needed) before starting the process:
  KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=greenmail.internal
This is an operator env var, not a tenant config value — a tenant cannot
add their own host to this list. A DNS resolution failure for a
genuinely unreachable host now surfaces as InboundTransientError (job
retry) instead of reaching imapflow at all.

### ledger

**Account code is unique per tenant (partial unique index read_ledger_accounts_tenant_id_code_uidx)**

`accountEntity` declares `read_ledger_accounts_tenant_id_code_uidx`, a unique index on `(tenant_id, code)` that only covers accounts with a code. Two parallel find-then-create calls for the same code (two tabs, two devices) could each create an account and leave a tenant with duplicate codes. The second write now fails with `unique_violation` (HTTP 409). This applies to `createAccount` and to an `updateAccount` that changes the code. Accounts without a code are unaffected, and the same code in different tenants stays allowed.

**Migration:** Before you apply the migration, check for existing duplicates:

  SELECT tenant_id, code, count(*) FROM read_ledger_accounts
  WHERE code IS NOT NULL GROUP BY tenant_id, code HAVING count(*) > 1;

`kumiko schema generate` treats a new unique index on a managed projection as destructive. It emits DROP TABLE + CREATE TABLE plus a `.rebuild.json`, which means a full event replay of `read_ledger_accounts`. A rebuild creates the table's indexes before it replays. So if a tenant's event history ever contained two accounts with the same code at the same time, the replay hits the unique index and fails, even after one of them was renamed. For an app with existing ledger data, hand-edit the generated migration before committing it. Replace the DROP/CREATE with an in-place

  CREATE UNIQUE INDEX IF NOT EXISTS "read_ledger_accounts_tenant_id_code_uidx"
    ON "read_ledger_accounts" ("tenant_id", "code") WHERE "code" IS NOT NULL;

and delete the `.rebuild.json`. The migrations snapshot stays as generated. If the duplicate check found rows, resolve them first through real writes, for example an `updateAccount` that gives the extra account another code. Never edit the table directly. For such a tenant, a later full rebuild of `read_ledger_accounts` still replays the historical duplicate and fails. An app that already created this index by hand under the same name (money-horse migration 0024) gets a no-op from the in-place statement.

Code that does find-then-create by code should expect `unique_violation` on create and re-read the account that won the race.

### mail-transport-smtp

**The tenant-configured SMTP host must resolve to a public address**

**Migration:** An operator relying on an internal SMTP relay or a local dev/test server
(mailpit, MailHog on localhost or a private IP) now gets a build-time
422 (code "unconfigured", naming the "host" config-key) unless that host
is explicitly allowed. Set the operator env var (comma-separated, read
at connect time — no boot-time code call needed) before starting the
process:
  KUMIKO_MAIL_ALLOWED_PRIVATE_HOSTS=mailpit.internal
This is an operator env var, not a tenant config value — a tenant cannot
add their own host to this list. Shared with inbound-provider-imap: one
env var covers both SMTP and IMAP allowlisting. A DNS resolution failure
for a genuinely unreachable host now surfaces distinctly (not as
"unconfigured") instead of only failing later at first-send time.

### step-dispatcher

**A webhook.send target host must resolve to a public address**

**Migration:** A workflow or handler pointing `r.step.webhook.send` at an internal
receiver or a local dev/test endpoint (localhost or a private IP) now
gets a delivery error (step.dispatch-failed) unless that host is
explicitly allowed. Set the operator env var (comma-separated, read at
dispatch time — no boot-time code call needed) before starting the
process:
  KUMIKO_WEBHOOK_ALLOWED_PRIVATE_HOSTS=webhook-receiver.internal
This is an operator env var, not a tenant/workflow-config value — a
workflow author cannot add their own host to this list. A DNS resolution
failure for a genuinely unreachable host now surfaces as a distinct
delivery error instead of only failing later inside `fetch()`.

## 0.319.0

### billing-foundation

**start-plan-checkout and switch-plan reject with FeatureDisabledError, not UnconfiguredError, when no provider is mounted**

**Migration:** start-plan-checkout and switch-plan now reject with FeatureDisabledError
(code "feature_disabled", HTTP 403) instead of UnconfiguredError (code
"unconfigured", HTTP 422) when no provider is mounted for the catalog. A
caller that specifically catches UnconfiguredError from these two
handlers, or branches on the 422 status, must catch FeatureDisabledError
/ branch on 403 instead.

**billing-plans now reports a scheduled cancellation and the panel offers reactivation**

**Migration:** SubscriptionView and BillingPlansResult.subscription gain two REQUIRED
fields: `currentPeriodEnd` (a `Temporal.Instant`, ISO string on
BillingPlansResult) and `cancelAt` (`Temporal.Instant | null`, ISO
string or null on BillingPlansResult). Any test fake that constructs a
SubscriptionView object literal directly must add both fields.
BillingPlansResult.currentTier also gains a `benefits` field
(via `catalog.benefits(currentTier)`), computed even when currentTier is
outside `catalog.plans` (e.g. a legacy/free tier).

The Stripe provider now maps `subscription.cancel_at` (or
`current_period_end` when only `cancel_at_period_end` is set) into a new
`cancelAtIso` event payload field; process-event applies it with
set/clear/leave-unchanged semantics, so an event without the field never
wipes a previously recorded value.

BillingPlansPanel shows an info banner ("Your subscription is scheduled
to end on {date}") whenever `subscription.cancelAt` is set and the
subscription isn't terminal, and swaps the manage-subscription button's
label to "Reactivate subscription" in the same case. The synthetic
current-tier card (a tier outside `catalog.plans`, e.g. a legacy/free
tier) now also renders `catalog.benefits(currentTier)` and the same
manage/reactivate action as a catalog card, via a shared helper — no
action needed unless an app relied on that card being action-less.

`read_subscriptions` gains a nullable `cancel_at` column. Every app that
mounts billing-foundation — including a plain `billingFoundationFeature()`
with no catalog (e.g. kumiko-studio) — must run
`bun kumiko-schema generate <name>` (offlot-app wraps it as
`bun run schema:generate <name>`) and commit the resulting migration. Skipping this leaves
the app's own `read_subscriptions` table without the column, so the
projection's `apply` fails at the next subscription webhook. The column
is additive and nullable — no rebuild, existing rows keep it `null`
until their next subscription webhook.

**create-checkout-session's mode:"payment" now requires a declared one-off-price allowlist**

**Migration:** SubscriptionProviderPlugin gains an `oneOffPriceIds` field (a readonly
string array, defaulting to empty). create-checkout-session's
mode:"payment" branch now rejects any priceId that isn't in the
resolved provider's `oneOffPriceIds` with an UnprocessableError whose
details.reason is "unknown_price" (same shape as the existing
subscription-mode price check) — previously any priceId was accepted,
so a TenantAdmin could start a one-off checkout against an arbitrary
Stripe price. mode:"payment" also now goes through the same
isBillingEnabled gate as mode:"subscription", before the redirect-origin
check, and fails with FeatureDisabledError when billing isn't enabled.

Every provider mount that offers one-off purchases (credit packs,
top-ups, ...) must list their priceIds explicitly. offlot-app's
start-pack-checkout.write.ts mounts Stripe for credit-pack purchases via
mode:"payment" and needs its pack priceIds added, e.g.:
`createSubscriptionStripeFeature({ priceToTier, oneOffPriceIds: configuredPackPriceIds() })`
(or the equivalent option on its provider plugin), or every pack
checkout starts failing with "unknown_price" after this release.
`oneOffPriceIds` is validated at mount time — an empty-string entry or a
duplicate priceId now throws instead of silently widening/narrowing the
allowlist.

**create-portal-session now computes returnUrl server-side and honors the catalog's purchase roles**

**Migration:** create-portal-session's payload schema is now `z.object({}).strict()` — a
client that still sends `{ returnUrl }` gets a 400 instead of the URL
being honored. The server now computes returnUrl itself from
`catalog.returnPath` (joined onto `baseUrl`) or, without a catalog or
returnPath, from `baseUrl` directly; a foundation mounted without
`baseUrl` fails the call with UnconfiguredError on the "baseUrl" key,
same as create-checkout-session. Update any client call to
`portalMutation.mutate({})` — BillingPlansPanel already does this and no
longer reads `window.location.href`, which used to trigger
redirect_origin_not_allowed on a `www.`-prefixed origin. A server-internal
caller like offlot-app's open-portal.write.ts, which currently does
`ctx.write(SubscriptionFoundationHandlers.createPortalSession, { returnUrl })`,
must drop the `returnUrl` field from that call and instead set the return
target via `catalog.returnPath` (or, without a catalog, the target is
simply `baseUrl`).

Access control also changed: with a catalog configured, the handler's
allowed roles are now `catalog.purchaseRoles` (falling back to the
catalog's default purchase roles) instead of the hardcoded
TenantAdmin/SystemAdmin pair. An app that lets e.g. a plain Admin role
purchase plans must add that role to `catalog.purchaseRoles` to keep
portal access working; conversely, a role that isn't in
`purchaseRoles` now gets a 403 where it previously reached the handler.

Set `catalog.returnPath` to the app's billing page (e.g.
"/host/billing", or offlot's `${APP_BASE_PATH}/${MY_BILLING_SCREEN_ID}`),
otherwise the portal sends the user back to the bare `baseUrl`.

## 0.318.0

### billing-foundation

**create-checkout-session and create-portal-session are now hardened: origin-checked redirects, known-price validation, plan-switch conflicts**

**Migration:** Mount the foundation via createBillingFoundationFeature({ baseUrl }) (a
path prefix is fine, e.g. "https://app.example.com/tenant-x"). Without
baseUrl, every create-checkout-session call now fails with an
UnconfiguredError on the "baseUrl" key, including mode:"payment" checkouts.

create-checkout-session: successUrl/cancelUrl must share baseUrl's origin,
or the call fails with an UnprocessableError whose details.reason is
"redirect_origin_not_allowed". For mode:"subscription" (the default when
mode is omitted), priceId must be a price the resolved provider's
priceToTier map actually knows about, and, if a catalog is configured,
must map to one of catalog.plans, or the call fails with reason
"unknown_price". A tenant with an existing non-terminal subscription can
no longer open a second subscription checkout. A ConflictError with
i18nKey "billing-foundation.errors.subscriptionExists" fires instead; call
billing-foundation:write:switch-plan to change plans. mode:"payment"
(one-off top-ups etc.) is exempt from both the price and the
subscription-conflict check and keeps working on an active subscription
unchanged.

Provider plugins written before this release should add a priceToTier map
on their SubscriptionProviderPlugin; without one, every mode:"subscription"
checkout is rejected with reason "provider_has_no_price_catalog".

Direct-priceId callers of create-checkout-session should migrate to a
catalog plus billing-foundation:write:start-plan-checkout /
billing-foundation:write:switch-plan (or the BillingPlansPanel widget),
which pick the price server-side and never expose a raw priceId to the
client.

create-portal-session: when baseUrl is set, the payload's returnUrl must
also share its origin, or the same redirect_origin_not_allowed error
fires. Unchanged when baseUrl is not configured.

create-checkout-session: an optional providerCustomerId is now only
accepted if it belongs to the tenant's own subscription at the same
provider, including a canceled one. Otherwise the call fails with an
UnprocessableError whose details.reason is "foreign_provider_customer".
This closes a gap where a TenantAdmin could pass another tenant's
provider customer id and have the checkout attach to that customer's
stored payment methods and invoices. Checked in both mode:"subscription"
and mode:"payment".

## 0.317.0

### @cosmicdrift/kumiko-testing

**bunfig --dom preloads the package's own DOM setup instead of an app-local file**

The package now exports `./preload/dom`, the happy-dom GlobalRegistrator
setup (IS_REACT_ACT_ENVIRONMENT, Bun's native fetch/Request/Response
preserved over happy-dom's broken cookie header, testing-library/react
cleanup, Radix pointer-capture/scrollIntoView stubs, the inspect-size
limit for waitFor) that each app using --dom previously copied into its
own ./test-setup/dom.preload.ts. `kumiko-testing bunfig --dom` now generates
bunfig.dom.toml with @cosmicdrift/kumiko-testing/preload/dom instead of
the app-local path. @happy-dom/global-registrator and
@testing-library/react are optional peer dependencies, same as
@playwright/test for ./e2e. This reverses kumiko-framework#3128, which
kept the file as an app-local copy because at the time it was
workspace-internal, not a published contract. In practice the copies
never diverged on purpose, only by drift: publicstatus, phronexsis and
kumiko-enterprise carried older, partial copies of the framework's own
test-setup/dom.preload.ts (missing the inspect-size fix for #3082), and
only offlot-app matched the framework's code (comments reworded, no
functional diff). The framework's own copy is now deleted; the
framework runs the same package preload it ships.

**Migration:** In every bunfig file that lists "./test-setup/dom.preload.ts"
(publicstatus, phronexsis, offlot-app and kumiko-enterprise each have
exactly one, their bunfig.dom.toml), replace that line with
"@cosmicdrift/kumiko-testing/preload/dom", then delete the now-
unreferenced ./test-setup/dom.preload.ts. Ensure
@happy-dom/global-registrator and @testing-library/react are in the
app's devDependencies (all four already have both). Running
`kumiko-testing bunfig --dom` instead also works: mergeBunfig now keeps
an app-local extra preload (publicstatus's
env.preload.ts/codegen.preload.ts) across the regen instead of dropping
it, and treats an existing "./test-setup/dom.preload.ts" entry as
superseded rather than an extra, so it doesn't end up preloaded twice
alongside the new package path. The generated preload array's own
entries stay first; a carried-over extra lands after them, which can
move it relative to entries that used to sit between the template's
preloads and the app's own (publicstatus: dom.preload.ts used to run
last, after env/codegen; the package preload now runs before them).

### framework-core

**"files: a valid upload (png/jpeg/gif/webp/pdf/doc/docx) under the wrong extension is normalized to its real type instead of rejected, when that type is in the field's accept list or the upload has no accept restriction at all"**

A real PNG or WebP saved with a .jpg extension (a common case for renamed
screenshots or messenger downloads) was rejected with content_mismatch
even when the field's accept explicitly allows png/webp, or when the upload
is unattached and has no accept restriction at all. validateFileContent now
also accepts the field's accept list; when the sniffed byte signature
doesn't match the declared extension but the sniffed type's own extension is
in accept, the upload proceeds under the sniffed mimeType with a storage key
built from the corrected extension, and the response reports the corrected
mimeType. When there is no accept restriction at all, any recognized
signature (png, jpeg, gif, webp, pdf, doc, docx) normalizes the same way.
The original filename is kept as the display name. A sniffed type whose
extension is not in a non-empty accept is still rejected with
content_mismatch.

**Migration:** validateFileContent's signature changes from (fileName: string, content: Uint8Array): string | null to (fileName: string, content: Uint8Array, accept?: readonly string[]): FileContentValidationResult ({kind:"ok"} | {kind:"normalized", extension, mimeType} | {kind:"rejected", error}). A direct caller that checked "if (result)" for an error must switch to checking result.kind === "rejected" and reading result.error — every branch of the new return type is a truthy object, so an unmigrated truthy check would now reject every upload. No caller besides the built-in POST /api/files route calls this function directly today (checked across kumiko-framework, kumiko-enterprise, kumiko-platform, kumiko-studio and every app consumer). buildStorageKey gains an optional trailing extensionOverride parameter; existing calls without it are unaffected.

## 0.315.0

### data-retention

**forget/policy-for now honor the tenant retention preset**

**Migration:** ResolveForTenantArgs.tenantPreset was renamed to preloadedTenantPreset (mirrors preloadedOverride): omitting it now makes the resolver load the tenant's retention preset itself instead of skipping it. Behavior change: forget (Art. 17) and the policy-for query now honor the tenant's compliance-profile-derived retention preset, not just entity defaults and per-tenant overrides. For tenants with a mapped compliance profile (e.g. de-hr-dsgvo-hgb), forget now keeps invoice/booking/contract rows via blockDelete and anonymizes order rows instead of hard-deleting them; notes-history mentions on such hosts are no longer shredded when the mentioned note's host entity is preset-protected. policy-for (data-retention:query:policy-for) now returns source: "preset" where it previously returned "none" for these entities.

### framework-core

**files: content verification is now keyed by filename extension, covering every signature-bearing type**

**Migration:** validateFileContent's signature changes from (mimeType: string, content: Uint8Array) to (fileName: string, content: Uint8Array): string | null. It now content-verifies every extension whose EXTENSION_MIME_WHITELIST entry overlaps MAGIC_BYTE_SIGNATURES (jpg/jpeg/png/gif/webp/pdf/doc/docx), not just doc/docx, and derives the check declaratively from the whitelist instead of a hardcoded per-format list. file-routes.ts now passes file.name instead of file.type (Bun derives File#type from the filename anyway, so the mimeType-keyed call was already comparing an extension-derived value to itself). A malicious extension shaped like a JS prototype property (constructor, __proto__, toString) resolves to "unknown extension" (no error) instead of crashing with a 500 — the same Object.hasOwn-guarded whitelist lookup is now shared by validateFile and validateFileContent. mime_mismatch remains a metadata-only pre-check; it is not real evidence of file content. Any test that uploads placeholder bytes (e.g. [1,2,3]) through the real upload route under one of the now-verified extensions must switch to real minimal signature bytes or a differently-named/unchecked extension.

## 0.314.0

### @cosmicdrift/kumiko-testing

**seed-user only reaches a tenant this server's seed-tenant route created**

seed-user looked the tenant up via tenant:query:me and only rejected a tenant
id that did not exist at all, so a tenant seeded by another server or
in-process without this route's seed-tenant still got a user added. seed-user
now checks the same seededTenantIds set as /__test/seed and rejects any other
tenant with the same 403.

**Migration:** Create the tenant via `seedTenant()` (the seed-tenant route) before adding users with `tenant.addUser`.

## 0.313.0

### delivery

**delivery direct sends to a route address can now be unsubscribed via a signed link**

ctx.notify(type, { route: { email } }) direct sends had no unsubscribe
path: only sends to a user account with a notification-preference row
could opt out, so a recipient with no account could never stop the mail.
Added hashUnsubscribeAddress (keyed blind-index hash of the trimmed,
lowercased address — the plaintext address never reaches the token or
the opt-out table), signAddressUnsubscribeToken (HS256 JWT, issuer
"kumiko:unsubscribe", no expiry — a leaked link can only opt one
address out of one notificationType/channel, and there is no signed-in
flow to request a fresh one), and a new notification-address-opt-out
event-sourced entity/table. createUnsubscribeRoute now accepts both the
existing user token and the new address token on the same route; the
existing signUnsubscribeToken and its JWT shape are unchanged. deliverDirect
now skips a channel (logDelivery status "skipped", error "unsubscribed", recipientAddress null)
when the destination address has an opt-out row for that tenant/
notificationType/channel, unless priority is "critical" — the same rule
user-preference suppression already follows. The lookup is skipped
entirely when no blind-index key is configured.

**Migration:** Run `kumiko migrate generate` to add the notification address opt-out table.

### subscription-stripe

**subscription-stripe mode:"payment" checkouts now get a Stripe invoice by default**

createCheckoutSession's mode:"payment" call (one-off top-ups etc.) never
passed invoice_creation, so Stripe never generated an invoice document for
those payments. It now defaults to `invoice_creation: { enabled: true }`
for mode:"payment" — mode:"subscription" is unaffected, Stripe rejects
invoice_creation there. Stripe Invoicing charges a per-invoice fee on top
of the payment itself, so an existing high-volume, low-value payment flow
may see new fees appear.

**Migration:** Pass `createSubscriptionStripeFeature({ paymentInvoiceCreation: false })`
to opt out and keep the old no-invoice behaviour for mode:"payment" checkouts.

## 0.312.0

### document-ingest-foundation

**document-ingest-foundation is provider-driven; ALLOWED_MIME_TYPES/MAX_FILE_BYTES are gone**

**Migration:** The hardcoded MIME allowlist and fixed size cap are removed. A provider feature (e.g. kumiko-enterprise's LiteParse) now registers via r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, "<name>", { mimeTypes, maxFileBytes }) and routes its r.job's trigger through documentIngestProviderTrigger("<name>") instead of a bare { on: DOCUMENT_INGEST_REQUESTED_EVENT_QN }. A provider feature must also declare r.requires("document-ingest-foundation") — validateBoot rejects r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, ...) without it as a missing feature dependency. Boot now throws if: two providers claim the same mimeType, a job triggers on documentIngest.requested without a provider filter, a job filters to an unregistered provider name, or a registered provider has no job wired to it. documentIngest.requested's payload gained a required provider field (event schema version 2; a migration upcasts existing v1 events to provider: "unknown", a sentinel that cannot match any real provider filter). A file whose mimeType has no registered provider now appends documentIngest.skipped with reason unsupported-mime-type instead of file-too-large. A fileRef.deleted or fileRef.forgotten event now forgets that fileRef's documentExtract row (new forget-extract-with-file-ref table-less MSP) — previously the extract silently outlived a deleted/forgotten source file. Mounting documentIngestFoundationFeature with zero providers is valid: every upload is simply skipped as unsupported-mime-type. Boot only fails for a misconfigured wiring (unfiltered job on documentIngest.requested, a job filtered to an unregistered provider name, two providers claiming the same mimeType, or a registered provider with no job wired to it).

### framework-core

**MultiStreamApplyContext gains a required registry field**

**Migration:** Any hand-built MultiStreamApplyContext (e.g. in an MSP test that constructs the context object literal instead of using createMultiStreamApplyContext/setupTestStack) must add registry: <the app Registry instance>, the same instance HandlerContext/JobContext already expose. Lets an apply resolve extension-point usages (registry.getExtensionUsages) to pick behavior by payload discriminant, e.g. a provider-routed MSP.

## 0.311.0

### @cosmicdrift/kumiko-guards

**test-timeouts is now always-enforcing, plus two new guards (test-template-drift, Real-Provider-Isolation)**

test-timeouts drops its transitional baseline/ratchet — any sleep loop,
test.setTimeout/test.slow, or waitForTimeout finding fails the guard run
directly, with no `.kumiko-test-timeouts-baseline.json` grandfathering
pre-existing violations.
New AST guard test-template-drift flags apps reimplementing the
kumiko-testing e2e/screenshot template locally: a Playwright config that
builds its own defineConfig(...) instead of calling defineAppE2eConfig(),
a literal deviceScaleFactor override anywhere (test.use, a project's use,
or the config's own use block), a literal viewport override in a
playwright*.config.ts's own use or a project's use (a spec's own
test.use({ viewport }) is not flagged — it's the documented way to assert a
layout that only exists below the template's 1920px default; a
`...devices["…"]` spread stays allowed everywhere), or a direct
page.screenshot(...) call instead of captureScreenshot.
New repo check Real-Provider-Isolation flags a CI workflow that references
KUMIKO_REAL_PROVIDERS or invokes test:real/e2e:real, a package.json script
other than test:real/e2e:real that leaks the real-provider env or a
*.real. spec/test reference, and one of the template's own non-real bunfig
files (bunfig.toml, bunfig.integration.toml, bunfig.dom.toml) missing the
**/*.real.test.ts exclusion.

**Migration:** Fix or mark each test-timeouts finding: replace hand-rolled poll loops with
the shared `waitFor` from @cosmicdrift/kumiko-framework/testing, or add
`// @timeout-exception: #<issue> <technical reason>` on the loop's own line
or the line above for a genuine non-condition wait. Delete any committed
`.kumiko-test-timeouts-baseline.json`.
For test-template-drift: switch a hand-rolled Playwright/screenshot config
to defineAppE2eConfig(), drop config-level viewport/deviceScaleFactor
overrides (the template already sets DESKTOP_VIEWPORT and renders
screenshot runs at SCREENSHOT_DEVICE_SCALE_FACTOR), and replace direct
page.screenshot(...) calls with the template's captureScreenshot. Specs
asserting a layout that only exists below 1920px set their own viewport via
test.use({ viewport }) — no exception marker needed. A deliberate exception
for anything else the guard flags (e.g. a handbook screenshot helper that
needs its own viewport-growth pass) is
`// @template-drift-exception: #<issue> <technical reason>` on the line
above.
For Real-Provider-Isolation: remove any KUMIKO_REAL_PROVIDERS/test:real/
e2e:real reference from CI workflows, move real-provider env/spec
references out of scripts other than test:real/e2e:real, and regenerate
bunfig.toml/bunfig.integration.toml/bunfig.dom.toml via
`kumiko-testing bunfig` instead of hand-editing pathIgnorePatterns.

### @cosmicdrift/kumiko-testing

**defineAppE2eConfig's chromium project renders screenshot runs at deviceScaleFactor 2**

With SCREENSHOT_DIR set, the chromium project renders at 2x so runMatrix and
captureScreenshot images stay sharp on HiDPI displays (desktop files are
3840×2160). Plain e2e runs stay at 1x. Device projects keep their own scale.

**Migration:** Drop app-level deviceScaleFactor overrides (test.use or project use).
Committed screenshots taken in the chromium project regenerate at 2x.

## 0.310.0

### @cosmicdrift/kumiko-testing

**defineAppE2eConfig's chromium project runs at 1920×1080 instead of Desktop Chrome's 1280×720**

The template took Playwright's "Desktop Chrome" device unchanged, so every
e2e run and every inline captureScreenshot rendered at 1280×720 while
runMatrix's desktop screenshots used 1920×1080. Both now share
DESKTOP_VIEWPORT (1920×1080). A root `use.viewport` override in an app's
playwright config never reached the chromium project anyway (project `use`
wins), so solon's 1920 override was silently ineffective.

**Migration:** Drop app-level desktop viewport overrides. Specs asserting a layout that
only exists below 1920px (collapsed sidebar, stacked panes) set their own
viewport via test.use({ viewport }). Committed inline screenshots taken
in the chromium project regenerate at 1920 width.

## 0.309.0

### @cosmicdrift/kumiko-testing

**reducedMotion defaults to "reduce" in runScreenshots/runMatrix/captureScreenshot; captureScreenshot(page, name) added**

rAF-driven chart/tween animations were invisible to the settle-detection
wait, so screenshots sometimes captured a mid-animation frame. Both matrix
helpers now call page.emulateMedia({ reducedMotion: "reduce" }) at test
start, before the first navigation. The new captureScreenshot(page, name,
opts?) applies the same media emulation at capture time, so it only affects
animations started after that point; set reducedMotion via test.use() for
mid-flow shots of charts that animate on mount. captureScreenshot reuses the
matrix runner's settle logic, writes $SCREENSHOT_DIR/<name>.png, and is a
no-op when SCREENSHOT_DIR is unset, for solon's mid-flow shot(page, id) and
offlot's inline page.screenshot writes into docs/screenshots/e2e/.

**Migration:** Pass `reducedMotion: "no-preference"` in runScreenshots/runMatrix's
options, or as captureScreenshot's third argument, for a scenario that
must keep real motion.

### data-retention

**data-retention hardDelete now purges file bytes + fileRef rows, not just the entity row (fw#3089)**

**Migration:** hardDelete previously deleted only the entity row and left every file/image/files/images field's storage bytes and `file_refs` row behind — a DSGVO Art. 17 gap. As of this release, an expired row's un-shared fileRefs (same tenant, bound to this row, not referenced by another row of the same entity) have their storage bytes deleted (including derivatives/thumbnails), then their `file_refs` row, then the entity row itself. A fileRef still referenced by another row, or bound to a different entity/record, is left untouched. Without a resolvable file-storage provider in the retention cron's job context, an entity with pending file deletions is skipped entirely (`skipped` reason `missing_file_storage`) rather than silently dropping the row with orphaned bytes; a storage-delete failure skips the row too (`file_delete_failed`) and retries on the next run. Before upgrading, a consumer relying on hardDelete NOT touching file storage should: list entities with `retention.strategy: "hardDelete"` and at least one file/image/files/images field, count rows already past `keepFor` for each, and confirm the referenced files are safe to delete (not needed elsewhere) before the next cron run.

## 0.308.0

### framework-core

**Boot validator rejects a projectionDetail screen/section/emptyState action with no resolvable icon (fw#3234)**

**Migration:** Every screen.actions / section.actions / section.emptyState.action entry on a projectionDetail screen, and every section.actions entry on an entityEdit screen, must resolve an icon: either an explicit `icon` on the action, or an id the shared action-icon map (@cosmicdrift/kumiko-types resolveActionIcon) already derives from the full id or its last/first kebab segment. entityEdit's own screen-level `actions` are not checked (unchanged, out of scope for this rule). An action that fails this now fails boot instead of rendering without an icon; give it an explicit `icon` or rename it to an id the map covers.

**Session and PAT revoke now close their own credential's open SSE stream, not just other reasons' userwide invalidations**

**Migration:** An app-injected SseBroker implementation must update its subscribeAccessInvalidation/publishAccessInvalidation signatures: the third parameter of subscribeAccessInvalidation is now an AccessInvalidationCredential object (`{ sid?, patTokenId? }`) instead of a bare sid string, and the second parameter of publishAccessInvalidation is now an AccessInvalidationScope object (`{ kind: "user" } | { kind: "all-except-session"; keptSessionId } | { kind: "sessions"; sessionIds } | { kind: "pat-tokens"; tokenIds }`) instead of a bare keptSessionId string. Example: `subscribeAccessInvalidation(userId, cb, sid)` becomes `subscribeAccessInvalidation(userId, cb, { sid })`, and `publishAccessInvalidation(userId, keptSessionId)` becomes `publishAccessInvalidation(userId, { kind: "all-except-session", keptSessionId })`.

### notes-history

**NotesSection no longer wraps its own "new note" / "history" blocks in a Card (fw#3234)**

As an extension section (its documented usage: `component: { react: { __component: NOTES_SECTION_EXTENSION_NAME } }`), NotesSection was already mounted inside the host's own section frame — its two internal Cards doubled the border/padding there. Both blocks now use a plain container with a `Heading variant="section"` sub-header instead.

**Migration:** A standalone `<NotesSection entityName={...} entityId={id} />` mount (outside a screen-schema extension section) now renders both blocks without their own card chrome — wrap it in a `Section`/`Card` if the standalone mount needs one.

## 0.307.0

### framework-core

**The public-intake gate now also covers jobs, event-triggered jobs, anonymous query roots and TenantDbs built from ctx.db.unsafeRaw (fw#3185)**

**Migration:** An anonymous handler (roles include "anonymous") without personalData: "public-intake" now fails when personal data (pii / userOwned / recordOwned) is written through any of these paths: a job it enqueues (write or query root), a job triggered by its handler event or by an r.defineEvent it appends, a job chained from such a job, a job ctx.write/writeAs into another handler, or a TenantDb built with createTenantDb on a ctx.db.unsafeRaw / ctx.systemDb.unsafeRaw runner (including savepoints on it). The error is AccessDeniedError with details.reason "public_intake_required"; for jobs details.job names the job and the job run fails. Declare access: { roles: [..., "anonymous"], personalData: "public-intake" } on the root write handler if the anonymous intake is intended, otherwise stop writing the field from that path. A query root cannot declare public-intake: move the enqueue from an anonymous query handler into a write handler that declares it. Raw SQL through unsafeRaw stays escapeHatch plus audit. Jobs without a stamped origin (cron, boot, jobs dispatched outside a request, jobs queued before this release) run as before; a job whose _writeOrigin is present but invalid fails before its handler runs.

## 0.306.0

### @cosmicdrift/kumiko-testing

**mailCapture and the /__test/inbox route read tenantless mail via a new mailOutbox option**

Apps sending Dev/E2E mail through a raw createInMemoryTransport() (signup,
forgot-password, magic-link — flows with no tenant) had no way to read it
through the seed inbox route, which required tenantId and only checked
mailTransportInMemoryFeature's per-tenant buffer. createE2eSeedRoutes()
now accepts mailOutbox: { sent: readonly EmailMessage[] } (the raw
transport's own array); inboxQuerySchema's tenantId is optional. The route
reads whichever source(s) are configured, filters by to, and returns each
source newest-first instead of oldest-first.

**Migration:** mailCapture(request, tenantId, to) -> mailCapture(request, to, { tenantId }),
and it now resolves to a single CapturedMail (the newest match) instead of
a readonly CapturedMail[]. Pass match: (mail) => boolean to pick a mail
other than the newest at that address. Apps with their own ungated debug
route for a raw transport (e.g. /_debug/mails.json) pass that transport as
createE2eSeedRoutes({ mailOutbox: transport }) and delete the app-local
route; tenantId becomes optional wherever only mailOutbox is used. Any
direct reader of GET /__test/inbox must expect newest-first ordering.

### framework-core

**A lifecycle hook's own escapeHatch now gates ctx.systemDb.unsafeRaw (fw#3198)**

**Migration:** Hooks, die in r.systemScope()-Handlern ctx.systemDb.unsafeRaw nutzen, deklarieren escapeHatch: { reason } in den r.hook-Optionen

**createUncheckedSystemDb is no longer exported from /db; use createSystemDbView, whose unsafeRaw follows the source TenantDb's escapeHatch gate (fw#3205)**

**Migration:** Import auf createSystemDbView umstellen; wer unsafeRaw auf einem selbstgebauten systemDb braucht, übergibt eine TenantDb mit unsafeRaw-Grant (createTenantDb(..., { unsafeRaw: { reason } })).
Delivery: ein tenantUserIdsQuery-Handler ohne r.systemScope() bekommt jetzt wie im Dispatcher eine tenant-mode ctx.db und kein ctx.systemDb; Handler, die Cross-Tenant-Zugriff brauchen, deklarieren r.systemScope().

**r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error**

**Migration:** Registrations of known extension points (tenantData, userData, fileProvider, derivativeRenderer, derivativeOverlayResolver, derivativePublicPredicate, principalStatus, tenantLifecycleStatus, tokenVerifier, sessionStore, tenantResolver, tenantExistence) now type-check their options, and options are required for them. Fix the reported mismatches: tenantData destroy hooks take TenantDataHookCtx and use ctx.db.* methods. For raw access such as archiveStream, declare escapeHatch: { reason } on the r.useExtension registration (runtime grant), call declareEscapeHatch({ reason }) as a direct statement in the hook body (Escape-Hatch-Declared guard), then use ctx.db.unsafeRaw(reason). userData registrations need at least one of export/delete (plus optional order). PrincipalStatusPlugin needs resolveProfile, FileProviderPlugin fakes need list(). App-owned points can opt in by augmenting KumikoExtensionOptionsMap via declare module "@cosmicdrift/kumiko-framework/engine"; unknown names keep the untyped options bag.

**Tenant-resource and tenantTierResolver extension options are typed; invalid registrations fail tenant destroy loudly**

**Migration:** Registrations of storageProvider, searchAdapter, externalResource and infraResource now require options of type TenantResourceExtensionHooks (destroyTenant(tenantId, ctx) => Promise<void>); tenantTierResolver requires a TierResolverPlugin with build. StorageProvider* types remain as aliases of the new TenantResource* types. A tenantData or tenant-resource registration whose destroy hook is missing now fails the destruction stage with the extension and entity name instead of being skipped.

**Idempotent retries re-run after a rolled-back 5xx instead of replaying it**

Because the retry re-runs, non-transactional side effects of the failed attempt (writes through `ctx.dbOutsideTransaction`, external calls made inside the handler) run again.
`IdempotencyGuard` has a new required method `release(tenantId, userId, requestId, token)` that frees the in-progress lock (token-guarded, like `store`) instead of persisting a result.

**Migration:** Custom IdempotencyGuard implementations must add release(tenantId, userId, requestId, token), which deletes the pending lock only if it still holds that token

### renderer-foundation

**Bundled extension points (renderer, deliveryChannel, mailTransport, inboundMailProvider, subscriptionProvider) are typed**

**Migration:** r.useExtension options for renderer ({ kinds, render }), deliveryChannel ({ mode, resolve, render?, send, accept? }), mailTransport (MailTransportPlugin), inboundMailProvider (InboundMailProviderPlugin) and subscriptionProvider (SubscriptionProviderPlugin) are now type-checked and required; renderer and deliveryChannel registrations do not pass name (it comes from the entity name). Prefer the new constants RENDERER_EXTENSION, DELIVERY_CHANNEL_EXTENSION and MAIL_TRANSPORT_EXTENSION over string literals. A registration whose options do not match the plugin shape now throws with the entity name when channels or renderers are collected.

## 0.305.0

### auth-email-password

**Session bootstrap failures now render a retryable error screen instead of hanging on "loading"**

fetchTenants()/fetchCurrentUser() failures (rate limit, 5xx, network)
used to reject out of the session bootstrap effect and leave the UI on
the loading placeholder forever. SessionStatus gained an "error" value
and SessionState gained a bootstrapFailure field; the auth gate now
renders SessionBootstrapErrorScreen with a Retry-After-aware retry
button for this case.

**Migration:** Code with an exhaustive switch over SessionStatus, or tests/stories that
hand-build a SessionState literal, needs to add the "error" case and the
bootstrapFailure field. refresh() no longer rejects on bootstrap
failures; it resolves and sets status to "error" instead.

### framework-core

**rateLimit.auth (L2) no longer throttles GET /api/auth/tenants**

The SPA's own session bootstrap called GET /api/auth/tenants on every
page load, which counted against the L2 auth-endpoint bucket and threw
429 on the 6th page load within a minute. This route is now exempted
from rateLimit.auth by exact method+path match; all other auth routes
(including POST on the same path, if ever added) are unaffected.

**Migration:** Apps using the default rateLimit.auth need no changes. Apps that want
to keep throttling GET /api/auth/tenants should rely on rateLimit.global
(L1, IP-based) instead. Credential-submitting POST routes are unaffected
even when rateLimit.auth's `path` option is customized.

**Writes under an anonymous root need access.personalData: "public-intake" at runtime, across feature boundaries (fw#3165)**

The boot check from fw#2885 only sees personal-data keys in an anonymous write handler's own input schema, for entities of its own feature. Every public dispatch (write, batch command, query, stream) now computes a WriteOrigin (root handler, anonymous root, public-intake declared) once. Every nested call inherits it: ctx.write, ctx.writeAs, ctx.query, ctx.queryAs, nested writes and afterCommit hooks. When the root is anonymous and does not declare public-intake, a write that touches a personal-data field (pii / userOwned / recordOwned) of any registered entity fails with AccessDeniedError, details.reason "public_intake_required". The error details name the root handler, the table and the fields, never the values. The check runs in TenantDb.insertOne/updateMany, in db.global().insertOne/updateMany and in the event-sourced create/update executor, after preSave and before the event append. It also covers rebound TenantDbs (acknowledgeCrossTenant, hook re-gating). Authenticated sessions are not affected. Not gated: ctx.db.unsafeRaw (covered by escapeHatch plus audit); ctx.appendEvent on a feature's own events (foreign events are already rejected); tables outside the registered entities; jobs and event subscribers queued from an anonymous root; and TenantDbs that handler code builds directly with createTenantDb. The last two are tracked in fw#3185, which also lists the bundled auth-email-password and user-data-rights flows that go through unsafeRaw or createTenantDb.

**Migration:** A write handler that anonymous callers can reach (roles include "anonymous") and that writes a personal-data field (pii / userOwned / recordOwned) of any entity must declare access: { roles: [..., "anonymous"], personalData: "public-intake" }. This applies whether the handler writes the field itself or through ctx.db, the CRUD executor, ctx.write, ctx.writeAs/queryAs or a postSave/afterCommit hook, and it applies across features. Without the declaration the write now fails with AccessDeniedError (details.reason "public_intake_required"). A failing afterCommit hook is only logged, and its write does not happen. Known consumer handlers, measured on 23.09.2026: offlot-app waitlist:submit, vehicle-enquiry:submit and try-first:set-contact; publicstatus email-subscriber:subscribe; show-pony rsvp:submit. Add the declaration if the anonymous intake is intended (the handler's rateLimit is then the only protection). Otherwise stop writing the field from the anonymous path.

## 0.303.0

### framework-core

**r.httpRoute's `anonymous` field is now required and controls the mount, not just docs (fw#2885)**

HttpRouteDefinition.anonymous changes from an optional, purely-documentary boolean to a required one that drives buildServer's mount. `anonymous: true` stays public, unchanged. `anonymous: false` now mounts the route behind the same session-auth chain /api/* uses: no anonymous fallthrough (a request without a session gets 401, never a synthesized anonymous user), the same PAT rate-limit guard, origin-allowlist guard and double-submit CSRF guard as /api/*, in the same order (auth → PAT → origin → CSRF). The handler reads the caller via getUser(c). feature-ui-extensions' httpRoute() now throws at feature-setup time when `anonymous` is missing or not a boolean (catches JS callers without the TypeScript type). The feature-AST (patterns/render/patcher/extractor/pattern-library) mirrors the field as required; a source file parsed before this change (missing `anonymous`) reads as `anonymous: false` — the safe side — and round-trip rendering always emits the field explicitly.

**Migration:** Every r.httpRoute({...}) call site must declare anonymous: true | false. Routes that were implicitly public (no field, or anonymous: true) keep working unchanged once anonymous: true is added explicitly — feature-ui-extensions now throws at boot for a route missing the field. Routes meant to require a session must set anonymous: false; a request without a session then gets 401 instead of running (there is no anonymous fallthrough on those routes any more), and a cookie-authenticated state-changing request needs the same X-CSRF-Token as /api/* or gets 403. Feature-AST round-trips: a saved feature file that predates this change parses `anonymous` as false (not true) — audit any httpRoute that was implicitly public and add `anonymous: true` before re-saving through the Designer/AI editor, or the next render will lock it behind the session-auth chain.

## 0.302.0

### framework-core

**Anonymous write handlers whose input accepts a personal-data field must declare access.personalData: "public-intake" (fw#2885)**

RoleAccessRule ({ roles, personalData? }) gains an optional personalData?: RoleAccessPersonalData (currently only "public-intake"), exported from @cosmicdrift/kumiko-framework/engine and /ui-types alongside OpenToAllPersonalData. validateAccessDeclarations now requires personalData: "public-intake" on a write handler whose access.roles includes "anonymous" and whose input schema accepts a personal-data field (pii / userOwned / recordOwned) of an entity in the same feature; declaring personalData on the roles form of a query or stream handler is rejected, "public-intake" on roles without "anonymous" is rejected, and "tenant-members" on the roles form is rejected (openToAll keeps accepting only "tenant-members"). Unlike the existing openToAll owner-binding exemption, an anonymous handler is never exempted by an owner-bound access.write map: every anonymous caller shares one user.id ("anonymous"), so from("user:id", ...) binds no one specific. The feature-AST extractor (readOptionalAccessRule) reads roles.personalData the same way it already reads openToAll.personalData.

**Migration:** A write handler with "anonymous" in access.roles whose input schema accepts a personal-data field of an entity in the same feature now fails boot until it declares access: { roles: [..., "anonymous"], personalData: "public-intake" }. Owner-binding via from("user:id", "<column>") on the entity access.write does not exempt an anonymous handler (it does exempt an openToAll handler) — anonymous requests share a single caller identity, so rely on the handler's required rateLimit (per ip) instead. personalData: "public-intake" is only valid on the roles form and only with "anonymous" in roles; openToAll keeps accepting only personalData: "tenant-members". The check only sees entities of the handler's own feature; anonymous intake into another feature's entity is covered by the follow-up runtime gate (kumiko-framework#3165). No known bundled-feature handler is affected.

## 0.301.0

### billing-foundation

**billing-foundation no longer exports SystemWriteResult (removed in 0.298.0 without a changelog note)**

**Migration:** SystemWriteResult was exported from @cosmicdrift/kumiko-bundled-features/billing-foundation up to 0.297.0 and was dropped in 0.298.0 together with the dispatchSystemWrite dep of createSubscriptionTierSync; there is no alias. Code that still imports it fails with "has no exported member 'SystemWriteResult'". If the type is only used for a dispatchSystemWrite dep passed to createSubscriptionTierSync, drop that dep and the type together (see the 0.298.0 webhook-wiring migration: extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()]). Where a system-write result type is still needed, import type { WriteResult } from "@cosmicdrift/kumiko-framework/engine" and use WriteResult<unknown>; it is a discriminated union ({ isSuccess: true; data } | WriteFailure), so narrow on isSuccess before reading data or error.

## 0.300.0

### auth-email-password

**auth handlers switch from GUEST_USER (roles: ["all"]) to the anonymous identity with a per-IP rateLimit**

**Migration:** The auth-email-password and auth-mfa handlers reachable from unauthenticated /auth/* routes (login, invite-accept-with-login, invite-signup-complete, reset-password, signup-confirm, verify-email, confirm-account-unlock, signup-request, the token-request handlers, mfa verify, mfa enable-start-preauth, mfa enable-confirm-preauth) now declare access: { roles: ["anonymous"] } instead of access: { roles: ["all"] }, each with its own rateLimit: { per: "ip+handler", limit, windowSeconds }. Enforcing that rateLimit on a request that carries a client IP requires a RateLimitResolver (Redis), same as the already rate-limited self-registration-status query; without one these handlers fail with InternalError (fail-closed, #1467). The password-reset, email-verification and account-unlock request routes keep answering 200 for anti-enumeration, so there the failure shows up as a "[kumiko] token request handler ... failed" error log line and no mail is sent. Wire Redis (or context.rateLimit) before relying on these routes. Test fixtures that hand-roll a guest SessionUser with roles: ["all"] must switch to roles: ["anonymous"] (or createAnonymousUser from @cosmicdrift/kumiko-framework/engine).

### framework-core

**Remove the guest-identity all-role: unauthenticated handlers must declare roles: ["anonymous"] with a rateLimit**

**Migration:** Handlers declared with access: { roles: ["all"] } now fail boot — no session ever carries the role "all", so this is unreachable dead config, not a wildcard. Switch to access: { roles: ["anonymous"] } plus rateLimit: { per: "ip" | "ip+handler", limit: N, windowSeconds: N } for unauthenticated callers, or access: { openToAll: { reason: "..." } } for any signed-in user. Test fixtures that hand-roll a SessionUser with roles: ["all"] (bridgeStub, hand-rolled guest literals) must switch to createAnonymousUser(tenantId) or roles: ["anonymous"]. buildSessionRoles now also strips "anonymous" and "all" out of globalRoles at every JWT mint (membership roles were already stripped). auth-routes.ts now dispatches every public /auth/* write with createAnonymousUser(SYSTEM_TENANT_ID) instead of the removed GUEST_USER constant.

## 0.298.0

### @cosmicdrift/kumiko-dev-server

**createKumikoServer/runDevApp take ExtraRouteDefinition[]; dev hostDispatch gets systemQuery**

**Migration:** extraRoutes on createKumikoServer/runDevApp changes from (app, deps) => void to readonly ExtraRouteDefinition[] - see the framework core changelog entry for the route-kind/dep breakdown. wire?: (deps: SystemWireDeps) => void | Promise<void> replaces non-route setup previously done inside the old extraRoutes callback. The dev hostDispatch callback now receives a second argument { systemQuery }; a dispatch implementation reading the dev db directly switches to systemQuery.

### @cosmicdrift/kumiko-server-runtime

**ExtraRoutesSystemDeps renamed to SystemWireDeps; hostDispatch gains systemQuery**

**Migration:** ExtraRoutesSystemDeps is renamed to SystemWireDeps and now backs the new wire hook instead of extraRoutes; WorkerWireDeps is derived from it. A consumer importing ExtraRoutesSystemDeps from server-runtime must switch to SystemWireDeps (same shape: db, redis, registry, dispatchSystemWrite). HostDispatchFn passed to runProdApp now takes a second argument { systemQuery } - a dispatch function reading db directly for routing decisions must switch to systemQuery.

### @cosmicdrift/kumiko-testing

**createE2eSeedRoutes() returns ExtraRouteDefinition[] instead of an extraRoutes callback**

**Migration:** createE2eSeedRoutes() now returns readonly ExtraRouteDefinition[] instead of an (app, deps) => void callback. The call site extraRoutes: createE2eSeedRoutes() in setupTestStack is unchanged, but any code that imported createE2eSeedRoutes() to invoke it directly against app (rather than passing it through extraRoutes) must instead treat the result as a route list, e.g. register each entry through the framework's ExtraRouteDefinition handling.

### billing-foundation

**Billing webhook wiring moves from a raw handler to createSubscriptionWebhookRoute()/createWebhookRoute()**

**Migration:** createSubscriptionWebhookHandler(...) is replaced by createSubscriptionWebhookRoute({ path?, afterDispatch? }), which returns an ExtraRouteDefinition for the extraRoutes array instead of a manually-mounted handler; the route path still defaults to /webhooks/subscription/:providerName. createSubscriptionTierSync(...) deps drop db, registry, dispatchSystemWrite and tierAssignmentTable - it now exposes .createWebhookRoute(), which produces the signature-verified ExtraRouteDefinition to add to extraRoutes. A webhook previously wired as extraRoutes: (app, deps) => { app.post("/webhooks/subscription/:providerName", createSubscriptionWebhookHandler(...)) } becomes extraRoutes: [createSubscriptionTierSync({ ... }).createWebhookRoute()] (or createSubscriptionWebhookRoute({...}) for the lower-level handler), with db/registry/dispatchSystemWrite no longer passed in - the route's signature-entry deps (systemQuery, dispatchSystemWrite, dispatchSystemQuery) cover the read/write access the old handler needed.

### framework-core

**extraRoutes/hostDispatch move to structured route and wire definitions**

**Migration:** extraRoutes on runProdApp/createKumikoServer/runDevApp/setupTestStack changes from (app, deps) => void to readonly ExtraRouteDefinition[]. Each entry is { method, path, entry: "anonymous" | "user" | "signature", handler }, built via the helpers in @cosmicdrift/kumiko-framework/api; a signature route also needs verify(request, deps) via signatureRoute<T>(). An anonymous GET route that used to call app.get(path, handler) on the raw app now receives { app, registry, systemQuery } - replace direct db/redis reads with systemQuery. A route reading user data via a raw db handle now declares entry: "user" (path must live under /api/, unauthenticated requests get 401 automatically) and receives { app, registry, user, query, write } instead of db/redis. A route verifying an external signature (webhooks) declares entry: "signature" and receives { app, registry, secrets?, systemQuery, dispatchSystemWrite, dispatchSystemQuery }; reject invalid signatures with ExtraRouteRejection(status, body) from verify. Non-route setup that used to run inside the old extraRoutes(app, deps) callback (late-binding, background seeds, starting a runner) moves to the new wire?: (deps: SystemWireDeps) => void | Promise<void> option on runProdApp/createKumikoServer, which gets { db, redis, registry, dispatchSystemWrite } but no app. hostDispatch (dev) and HostDispatchFn (runProdApp) gain a second argument { systemQuery }; an app.use middleware that read db directly for host dispatch now uses systemQuery instead.

### inbound-mail-foundation

**createInboundMailConnectRoutes() returns ExtraRouteDefinition[] with static options only**

**Migration:** createInboundMailConnectRoutes(options) now returns readonly ExtraRouteDefinition[] (connect route as entry: "user", callback route as entry: "signature") instead of mounting itself on app. options is now static config only - any db/registry/dispatch values previously passed through options are supplied by the framework via the route's deps instead. Replace extraRoutes: (app, deps) => createInboundMailConnectRoutes(options)(app, deps) with extraRoutes: createInboundMailConnectRoutes(options) (spread into the app's route array alongside other route definitions).

## 0.296.0

### delivery

**delivery requires tenant**

**Migration:** delivery now declares r.requires("tenant") because its delivery-log screen references tenant:tenant. Stacks that mount delivery must also mount createTenantFeature() (and its config dependency).

### framework-core

**refEntity on projectionList/relatedList columns and projectionDetail fields is boot-checked against registered entities**

**Migration:** A refEntity that does not resolve to a registered entity now fails boot with the target and the known entities of the target feature (same message as a reference facet). Fix the typo, or mount and r.requires() the target feature; test stacks booting a feature without its refEntity target feature must add it.

## 0.291.0

### framework-core

**projection-rebuild aborts instead of silently NULLing populated blind-index columns (fw#3091)**

`kumiko schema apply` rebuilds a projection through a fresh shadow table replay, and the shadow always recomputes every `<field>_bidx` column with whatever blind-index key is configured in the running process. A projection rebuilt in a process without `KUMIKO_BLIND_INDEX_KEY` set — most commonly the `migrate-db` init container that runs `kumiko schema apply` on deploy — silently swapped the live table for one where every bidx column had gone NULL, breaking equality lookups (login, password reset) with no error anywhere. `rebuildProjection` now checks, right before the swap, whether the live table already has populated bidx columns while no key is configured in this process; if so it throws and leaves the live table untouched instead of completing the swap.

**Migration:** Plaintext installations and the fw#1610 case (KMS configured, no blind-index
key) are unaffected — their bidx columns are NULL already, so there is
nothing for the rebuild to lose. This only blocks a rebuild that would
otherwise destroy already-populated bidx columns: any process running
`kumiko schema apply` (or another projection rebuild) against a table with
live blind-index data must have `KUMIKO_BLIND_INDEX_KEY` set. Wire that env
var into the `migrate-db` init container (or wherever schema apply runs in
deploy) alongside the app's own KUMIKO_BLIND_INDEX_KEY, or the rebuild aborts
instead of quietly breaking equality lookups.

**Declared event PII fails closed without a subject KMS (fw#2776)**

`defineEvent` has required an explicit PII stance since fw#2558, but a declared stance still did not guarantee ciphertext in `kumiko_events`. Two paths leaked silently and now fail closed.
Boot: `assertPiiBootInvariants` only looked at entity annotations, so an app whose PII lives exclusively in catalogued events booted without a `kms` adapter and wrote plaintext. It now collects events with a non-`"none"` stance alongside the PII entities — prod aborts, dev warns, `allowPlaintextPii: "<reason>"` acknowledges, same as for entities.
Append: `{ personal: { of: "<ownerField>" } }` skipped encryption whenever the owner field carried no id, so the same event type was ciphertext for user-triggered writes and plaintext for system-triggered ones with no signal. The stance now carries `whenAbsent`: `"tenant"` encrypts under the envelope tenant key, `"plaintext"` is an explicit acknowledgement that the value cannot be crypto-shredded. Registration rejects a nullable owner field without one, and an owner that is empty at append time with no declared fallback aborts the write instead of storing the value in the clear.
`delivery:event:attempt` declares `whenAbsent: "tenant"` — a send whose `recipientId` is null now stores the recipient address under the tenant key instead of in plaintext.

**Migration:** Three things can newly fail. (1) Boot aborts with `BOOT ABORTED — ... events
[...]` when a mounted feature declares a non-`"none"` `piiFields` stance and
`runProdApp`/`runWorkerApp` gets no `kms`. Pass
`kms: createPgKmsAdapter({ databaseUrl, platformKek })`, or acknowledge the
plaintext with `allowPlaintextPii: "<reason>"` until the KMS is provisioned;
`runDevApp` only warns. (2) Registration aborts when a
`{ personal: { of: "<ownerField>" } }` stance names an owner field the payload
schema allows to be null or undefined. Add `whenAbsent: "tenant"` to encrypt
those writes under the envelope tenant key, or `whenAbsent: "plaintext"` to
declare that the value ships unencrypted and is not crypto-shreddable. The
deprecated `{ subjectField: "<ownerField>" }` form cannot express `whenAbsent`
— move it to the canonical `{ personal: { of: ... } }` form. (3) `append()`
throws `SubjectResolutionError` when the owner field is empty at write time
and the event declared no `whenAbsent`. Registration catches this for
ZodObject payload schemas; a non-object schema surfaces it here. An owner
value that is not a non-empty string — a numeric id, an empty string — counts
as absent, so it takes the same path and needs the same declaration.
Separately, `delivery:event:attempt` rows written with a null `recipientId`
used to hold a plaintext recipient address in `kumiko_events` and in
`store_delivery_attempts`. New rows are tenant-subject ciphertext.
`delivery:query:log` decrypts either form, so the admin log view is unchanged;
tooling that reads `store_delivery_attempts.recipient_address` directly must
go through `decryptStoredPii`. Existing plaintext rows stay readable and are
re-encrypted by `backfillEventPiiEncryption`.

**money fields on actionForm/secretMint screens declare their currency source (fw#2839)**

`actionForm` and `secretMint` have no entity, so their money fields never received `entity.defaultCurrency`: an untouched one seeded a bare `0` that the handler's zod schema then rejected on submit. fw#2763 closed the prefill half of this; the default half stayed open. `MoneyCurrencySource` gains `{ kind: "literal", code }` next to the existing `{ kind: "tenant" }`, and the field maps of `actionForm`, `secretMint` and its `confirm` step are narrowed so a money field there requires `currency` — enforced by the compiler at bump time and by the boot validator for untyped callers. A literal code is checked against the app's `currencies` list, the same rule `entity.defaultCurrency` already follows. Entity fields, embedded-list money cells and `configEdit`'s plain-number contract are unchanged.

**Migration:** Only affects entity-less form screens — `actionForm`, `secretMint` and a
secretMint's `confirm` step — that hold a `money` field. Entity money fields
are unchanged (`entity.defaultCurrency` is already boot-enforced for them),
as are embedded-list money cells (currency at the head, fw#2764) and
`configEdit`, which keeps its plain-number contract.
Add a `currency` to each money field in such a screen's `fields` map:
`currency: { kind: "literal", code: "EUR" }` for one fixed currency, or
`currency: { kind: "tenant" }` for the tenant's own currency.
A `literal` code must be in the app's `currencies` list (`createApp({ currencies })`,
which already includes the defaults). A `tenant`-declared field resolves through
the tenant-settings bundle and holds the form until the value has landed, so that
bundle has to be mounted. Missing declarations fail at compile time; an untyped
caller fails at boot with the screen and field name in the message.

### rate-limiting

**`rate-limiting:query:status` only peeks buckets of the calling tenant (fw#3076)**

The handler took an arbitrary bucket key and peeked it, so a tenant Admin who knew or guessed another tenant's key could read that bucket's counter. The key is now matched segment-exact against the caller: `tenant:`/`tenant+handler:` must carry the caller's own tenant id, `user:`/`user+handler:` the caller's own user id. Everything else — other tenants, other users, the global `ip:`, `l1:` and `l2:` middleware buckets, malformed keys — is `access_denied` (`bucket_outside_tenant`) unless the caller is SystemAdmin, whose access is unchanged. The check runs before the resolver-wiring check, so a denied caller learns nothing about the mount either.

**Migration:** Only affects non-SystemAdmin callers of `rate-limiting:query:status`. A tenant
Admin keeps `tenant:<own>`, `tenant+handler:<own>:<handler>`, `user:<self>` and
`user+handler:<self>:<handler>`. Two reads it had before now need SystemAdmin:
another user's bucket inside the same tenant (the tenant is not part of a
`user:` key, so it cannot be verified without a membership lookup) and the
global `ip:`/`l1:`/`l2:` buckets, which are not tenant-owned. Ops tooling that
peeks those from a tenant Admin session has to run as SystemAdmin.

## 0.289.0

### framework-core

**appendProvenanceEvent enforces event.tenantId === db.tenantId**

`appendProvenanceEvent(db, event)` checked the event type namespace but wrote `event.tenantId` unverified while granting itself the framework-fixed unsafeRaw reason internally. Since `createLLMProviderForTenant(ctx, tenantId, …)` takes the tenantId as an argument, that made the entry point a cross-tenant write door with no escapeHatch declaration behind it.
The check now runs after `unsafeRawForDeclaredStep` — so a holder not built by `createTenantDb` still fails closed with `InternalError` first — and before the savepoint, so a rejected append leaves no row. It is unconditional, including `mode: "system"`: `crossTenantRebinders` keeps the original tenantId and only flips the mode, so a system-scoped db must not append provenance for a foreign tenant either.
`appendProvenanceEvent` deliberately keeps `withUnsafeRawGrant` + `unsafeRawForDeclaredStep` instead of resolving the runner through the ungated `tenantDbRunner`, because that grant path is the choke point the member-read lock in kumiko-framework#2927 hooks into.

**Migration:** appendProvenanceEvent rejects with AccessDeniedError when event.tenantId does not match the tenantId of the passed TenantDb. Provenance for a foreign tenant has no path left through this entry point — a caller that needs it declares its own escapeHatch path instead. Blast radius checked: every known call site in kumiko-enterprise passes event.user.tenantId through, so no call site changes.

**Boot fails when an anonymous-accessible handler declares no rateLimit**

validateAnonymousRateLimit (packages/framework/src/engine/boot-validator/entity-handler.ts) previously returned early when a handler declared no rateLimit at all, so an anonymous, internet-facing handler with zero throttling passed boot silently while one with a merely wrong bucket (rateLimit.per="user") was rejected. The check now runs for every handler whose access.roles includes "anonymous": it still skips openToAll handlers (they never admit anonymous) and rateLimit: { disabled: true, reason } declarations, but a handler with access.roles including "anonymous" and no rateLimit at all now throws at boot, naming the handler.

**Migration:** Every handler whose access.roles includes "anonymous" needs a rateLimit declaration: either rateLimit: { per: "ip" | "ip+handler", limit, windowSeconds } (per must not be "user"/"user+handler" — anonymous callers share user.id="anonymous", so a user-keyed bucket is a single global tap), or the documented exception rateLimit: { disabled: true, reason: "..." } for a handler that must not be rate-limited. This PR fixes the eight bundled-features handlers that tripped this at authoring time: compliance-profiles:query:sub-processors, template-resolver:query:by-slug, template-resolver:query:by-tenant, managed-pages:query:by-slug, managed-pages:query:by-tenant-published, managed-pages:query:branding, auth-email-password:query:signup-registration-status, seo:query:config.

**ctx.db.unsafeRaw is denied under ctx.queryAsMember**

**Migration:** Query handlers reached through ctx.queryAsMember can no longer call ctx.db.unsafeRaw — not even for reads. Move them to the ctx.db query APIs, or stop calling them via queryAsMember. Consequence for kumiko-enterprise: ai-call provenance writes under queryAsMember now fail closed; withProvenance swallows the error and counts provenance_drop_total.

**requiredKeysFromScreen reads section.groups — group field labels and group titles are i18n-required**

`requiredKeysFromScreen` (packages/framework/src/i18n/required-surface-keys.ts) read only `section.fields` in all six `EditFieldsSection` branches (`entityEdit`, `actionForm`, `secretMint` mint + confirm layout, `configEdit`, `projectionDetail`), so a field declared through `section.groups` never reached the required-key set and `groups[].title` was never required at all — while `computeEditViewModel` translates a group title exactly like a section title. `validateI18nSurfaceKeys` therefore let a screen boot with untranslated group field labels and group titles, the one error class that guard exists for.
The new `sectionFieldSpecs` in packages/framework/src/engine/screen-helpers.ts returns the union of `section.fields` and `section.groups[].fields` (a union, unlike the boot-validator's either-or `flattenFieldsOrGroups`, which runs after the fields-XOR-groups check) and is used at all six branches; each branch now also pushes every `groups[].title` alongside `section.title`, honoring the same `treatDotFormAsKey` option. The `writeForm` branch in `projectionDetail` is unchanged — `EditWriteFormSection` has no `groups`.

**Migration:** The i18n boot guard now demands translations it silently skipped before. An app whose entityEdit/actionForm/secretMint/configEdit/projectionDetail screens declare fields through `layout.sections[].groups` can newly fail boot with `required translation key missing: "<feature>:entity:<entity>:field:<name>"`. Add the missing field-label keys (or a `fieldLabels` override, where that screen type supports one) for every field declared under `groups[].fields`. Colon-form `groups[].title` values are now required too — add the key, or keep the title as literal display text (no colon, no `i18nKey()`) if it is not meant to be translated. Dot-form group titles behave exactly like dot-form section titles: only required when the caller passes `treatDotFormAsKey`.

## 0.281.0

### framework-core

**declareEscapeHatch is a new export from @cosmicdrift/kumiko-framework/engine**

**Migration:** A standalone helper that escalates (`unsafeRaw`, or `queryAs`/`writeAs` with a
system identity) on a `HandlerContext` handed to it by its caller — rather than
baselining the Escape-Hatch-Declared Guard finding — declares it at the call
site instead: `declareEscapeHatch({ reason: "..." })` as the first statement of
the helper's body, describing what is escalated and on whose right (the caller's
handler still carries its own `escapeHatch` declaration). The reason must be a
string literal and not a placeholder (see the guard's generic-reason check) —
there is no boot validator behind this form to catch an empty or vague one.

**withUnsafeRawGrant is no longer exported from @cosmicdrift/kumiko-framework/db**

**Migration:** A consumer that imported `withUnsafeRawGrant` from `@cosmicdrift/kumiko-framework/db` to grant itself `unsafeRaw` access declares `escapeHatch: { reason: "<why>" }` on the relevant registration (handler, hook, or `r.useExtension(...)`) instead, then fetches the runner with `ctx.db.unsafeRaw("<same reason>")`. No blast radius found outside the framework itself: no app repo, kumiko-platform, kumiko-studio, or kumiko-enterprise code used this symbol.

## 0.280.0

### framework-core

**TenantDataHookCtx/UserDataHookCtx.db is a tenant-filtered TenantDb; unfiltered hook access needs r.useExtension({ escapeHatch }) (fw#2914 Zugang 3).**

EXT_TENANT_DATA `destroy` hooks (`TenantDataHookCtx.db`) and EXT_USER_DATA `export`/`delete` hooks (`UserDataHookCtx.db`) no longer receive the unfiltered `DbRunner` that was bound to the extension's owning handler. Both are now a `TenantDb` in "tenant" mode, built via the public `createTenantDb(...)`, bound to the hook's `tenantId`: reads/writes go through `ctx.db.selectMany/fetchOne/insertOne/updateMany/deleteMany`, already scoped to that tenant plus `SYSTEM_TENANT_ID` reference rows. `r.useExtension(EXT_USER_DATA | EXT_TENANT_DATA, entityName, { ... })` gains an `escapeHatch?: { reason: string }` option, validated non-empty at registration time (throws at boot for an empty/whitespace reason). Declaring it grants `ctx.db.unsafeRaw(reason)` inside that entity's hooks — same reason string — which returns the real, unfiltered `DbRunner`; without it, `ctx.db.unsafeRaw(reason)` throws `AccessDeniedError`. Every granted use reports an `"unsafe-raw"` escape-hatch audit event (`{ handler: "userData:<entity>"|"tenantData:<entity>", kind, reason, tenantId, actor }`) through the caller's `_escapeHatchAuditSink` when wired, else a `security:escape-hatch-used` warn-log — same #2861 pattern PR #2934 already applied to the job runner, and the same one fw#2914's earlier JobContext.db and read-step changes already applied elsewhere in the framework. `run-forget-cleanup.ts`/`run-user-export.ts` (user-data-rights) thread `escapeHatchAuditSink`/`actor` from their owning `r.job`'s `ctx._escapeHatchAuditSink`/`ctx.systemUser.id` down to each hook's `TenantDb`, so a declared use is attributed to the real job run, not `"<unattributed>"`.
`asRawClient(ctx.db)` inside a hook now throws immediately: `asRawClient` rejects a `TenantDb`-shaped argument ("received a tenant-scoped TenantDb (ctx.db). Raw SQL helpers do not apply the tenant filter — use a ctx.db.<method>, or ctx.db.unsafeRaw(reason) with escapeHatch: { reason } ..."). The framework's `DbRunner`-typed free functions (`selectMany(db, table, where)`, `fetchOne`, `insertOne`, `updateMany`, `deleteMany`, `createTenantDb(db, tenantId, mode)`, etc. from `@cosmicdrift/kumiko-framework/bun-db`/`/db`) now reject `ctx.db` as their first argument at compile time too — `TenantDb` does not structurally satisfy `DbRunner` (no `.unsafe`/`.begin`).
A table built via `createEntity`+`buildEntityTable`+`r.entity(...)` carries the pre-existing `EXECUTOR_ONLY` brand, so `ctx.db.insertOne/updateMany/deleteMany(table, ...)` against it is a compile error by design ("a managed projection is only writable through the executor"); a hook that needs to write such a table directly (bulk hard-delete, jsonb key removal, an UPDATE expression `updateMany`'s literal-value `set` can't express) needs the `escapeHatch` + `ctx.db.unsafeRaw(reason)` route, filtering by tenant/owner in the SQL text itself — the escape hatch removes automatic tenant-filtering, not the hook author's responsibility to filter. A table built via `defineUnmanagedTable` carries no such brand and stays writable through `ctx.db`'s typed methods directly.
This PR's own `custom-fields` user-data-rights wiring (`wire-user-data-rights.ts`) uses the escape hatch for exactly this reason: `selectCustomFieldsHostRows` runs against a dynamic host table name unknown at compile time, so it can't use `ctx.db`'s typed methods. CI's `AST-Guards (shared runner)` step (`@cosmicdriftgamestudio/kumiko-guards@^0.36.0`, pinned) does not yet recognize this call shape — `isEscapeHatchDeclaredFunction` in `guard-escape-hatch-declared.ts` only matches a property/method literally named `handler`, or a direct call to `hook`/`writeHandler`/`queryHandler`/`streamHandler`; `r.useExtension(EXT_USER_DATA, entityName, { export: exportHook, escapeHatch })` matches neither, because `useExtension` isn't in `ESCAPE_HATCH_CALL_METHODS` and the hook property here is `export`/`delete`, never `handler`. This also isn't fixable by baselining from kumiko-framework: `security-baselines/<repo>.json` ships inside the pinned `@cosmicdriftgamestudio/kumiko-guards` npm package itself, and `run-guards.ts`'s own comment states it is rewritten only by "the infra baseline-maintenance run over all repos on main" — never by a consuming repo's local run, and never persisted through a consuming repo's `bun install`. The fix belongs in the guard's owning repo (presumably `infra`, per this workspace's root `CLAUDE.md`): add `useExtension` to `ESCAPE_HATCH_CALL_METHODS`, or otherwise recognize the framework's actual hook-property names (`export`/`delete`/`destroy`), then release a new `@cosmicdriftgamestudio/kumiko-guards` version and bump the range in kumiko-framework's `package.json`. Until that lands, this PR's `AST-Guards (shared runner)` CI check stays red on this one finding; every other check is green.

**Migration:** A hook that only reads/writes its own tenant through `ctx.db` method calls (`ctx.db.selectMany/fetchOne/insertOne/updateMany/deleteMany`) needs no change — it now gets the same tenant filter every other `TenantDb` consumer already had. A hook that treated `ctx.db` as a raw connection (`asRawClient(ctx.db)`, `ctx.db` passed as the first argument to a free-function `selectMany`/`fetchOne`/`insertOne`/`updateMany`/`deleteMany`/`createTenantDb`, a cast to `DbRunner`/`DbConnection`, or `"raw" in db ? db.raw : db`) must add `escapeHatch: { reason: "<why>" }` to its `r.useExtension(EXT_USER_DATA | EXT_TENANT_DATA, entityName, { ... })` registration and fetch the runner explicitly with `ctx.db.unsafeRaw("<why>")` (same reason string) at the point of use. Prefer converting to `ctx.db`'s typed methods first — reach for `unsafeRaw` only when the target table is `EXECUTOR_ONLY`-branded (a managed `r.entity(...)` table; typed writes reject it by design — see the `EXECUTOR_ONLY`/`WritableTable` note in Detail) or the SQL needs an expression the typed API can't produce (e.g. a jsonb `-` key-removal `UPDATE`). No codemod — cross-hook raw-SQL usage is expected to be rare enough, and tenant-filter-relevant enough, to review by hand per hook. Hand-built `TenantDataHookCtx`/`UserDataHookCtx` objects in tests need `db: createTenantDb(conn, tenantId, "tenant", undefined, undefined, undefined, { unsafeRaw: { reason: "<why>" } })` instead of a plain connection.

Audit at release: kumiko-enterprise has seven user-data hook files across five packages that take `ctx.db` as a raw `DbRunner` argument (`createTenantDb(ctx.db, ctx.tenantId, "system")` and free-function `selectMany(ctx.db, table, where)`). Each needs `escapeHatch` on its `r.useExtension(...)` plus `createTenantDb(ctx.db.unsafeRaw("<why>"), ctx.tenantId, "system")`, and the reads become `ctx.db.selectMany(table, where)` (already tenant-scoped, no "system" mode needed). They must be migrated in kumiko-enterprise itself before it bumps its pinned `@cosmicdrift/kumiko-framework`/`@cosmicdrift/kumiko-types` version, or `tsc` fails.

Guard-version gap: a consumer that declares `escapeHatch` on a `r.useExtension(...)` registration needs a `@cosmicdriftgamestudio/kumiko-guards` release newer than `^0.36.0`; the shared AST guard run of older versions does not recognize it. Bump the guards range before or alongside this migration, not after.

## 0.278.0

### cap-counter

**createStockCapGuard/checkStockCap/withStockCap resolve through the caller's TenantDb, not a raw DbRunner + explicit tenantId (fw#2854).**

`createStockCapGuard`'s resolver is now `(db: TenantDb) => Promise<TCaps>` instead of `(db: DbRunner, tenantId: TenantId) => Promise<TCaps>`. `checkStockCap(db: TenantDb, spec)` drops the separate `tenantId` parameter — the tenant comes from `db.tenantId`, and the count runs through `TenantDb.count` instead of the raw `countWhere`. `StockCapSpec.table` is now typed `SchemaTable | EntityTableMeta` (matching `TenantDb.count`'s table parameter) instead of `Parameters<typeof countWhere>[1]`. `withStockCap` no longer declares an `escapeHatch` on the wrapped handler and no longer reads through `ctx.db.unsafeRaw(...)` — it calls `checkStockCap(ctx.db, spec)` directly, so a `TenantAdmin`-only handler with no `escapeHatch` can use it.

**Migration:** `createStockCapGuard(async (db, tenantId) => ...)` → `createStockCapGuard(async (db) => ...)`, reading `db.tenantId` instead of the removed second argument. A direct `checkStockCap(runner, tenantId, spec)` call → `checkStockCap(tenantDb, spec)` with a `TenantDb` built via `createTenantDb(runner, tenantId)` (or `ctx.db` inside a handler). If your wrapped handler relied on `withStockCap`'s auto-added `escapeHatch` for some other reason, declare it explicitly on the handler instead — `withStockCap` no longer adds one.

### tier-engine

**createTierResolver's resolveTier/resolveTierCaps take only a TenantDb — no separate tenantId argument (fw#2854).**

`resolveTier(db)` and `resolveTierCaps(db)` (from `createTierResolver`) now read the tenant from `db.tenantId` instead of taking a second `tenantId` parameter, so a caller can no longer pass a `TenantDb` for one tenant alongside a different `tenantId` and resolve a foreign tenant's tier.

**Migration:** `resolveTier(ctx.db.raw|runner, tenantId)` → `resolveTier(ctx.db)` (same for `resolveTierCaps`). Outside a handler: `resolveTier(createTenantDb(runner, tenantId))`.

## 0.275.0

### files-tenant-data

**sweepOrphanedDerivativesJob takes the raw DbConnection as a third argument; the job declares escapeHatch (fw#2914).**

JobContext.db is now a tenant-filtered TenantDb. The sweep checks fileRef owners of every tenant, so its registration declares `escapeHatch` and passes `ctx.db.unsafeRaw(reason)` to `sweepOrphanedDerivativesJob(payload, ctx, db)`. Without the raw runner, the foreign-tenant owner lookup would be narrowed away and every derivative would look orphaned.

**Migration:** Direct callers of the exported `sweepOrphanedDerivativesJob` pass the raw `DbConnection` as the third argument. Apps that only mount the feature need no change.

### framework-core

**JobContext.db is a tenant-filtered TenantDb; unfiltered job access needs r.job({ escapeHatch }) or r.systemScope() (fw#2914).**

Job handlers no longer receive the unfiltered boot `DbConnection` as `ctx.db`. `JobContext.db` is now a `TenantDb` in "tenant" mode, bound to the job's resolved tenant (`_tenantId`, `payload.tenantId`, or `SYSTEM_TENANT_ID` for tenant-less cron jobs). Reads see that tenant plus `SYSTEM_TENANT_ID` reference rows, and writes are scoped to it. `JobDefinition` gains `escapeHatch?: { reason }`: it grants `ctx.db.unsafeRaw(reason)` for that job and reports an `"unsafe-raw"` escape-hatch audit event through `_escapeHatchAuditSink` (deduplicated like handler grants). Without it, `ctx.db.unsafeRaw` throws `AccessDeniedError`. `r.systemScope()` features keep `ctx.systemDb` unchanged. `r.job` throws at registration for an `escapeHatch` with an empty reason. Framework `soft-delete` cleanup jobs run on the tenant-filtered `TenantDb` without a grant. Bundled cross-tenant jobs now declare `escapeHatch`: auth-mfa reencrypt, sessions cleanup, form-draft cleanup, secrets rotate, files-tenant-data sweep-orphaned-derivatives, data-retention retention-cleanup, inbound-mail-retention, tenant-lifecycle run-tenant-destruction, and user-data-rights run-export-jobs/run-forget-cleanup. The systemScope features config, jobs and workflow-runner use `ctx.systemDb.unsafeRaw`. The exported `rotateJob` (secrets) and `sweepOrphanedDerivativesJob` (files-tenant-data) take the raw `DbConnection` as a third argument.

**Migration:** Jobs that only read and write their own tenant through `ctx.db` method calls or `selectMany/fetchOne/insertOne/updateMany/deleteMany(ctx.db, ...)` need no change. A job that treated `ctx.db` as a `DbConnection` (casts, `asRawClient`, `countWhere`, `upsert*`, `incrementCounter`, `createTenantDb(ctx.db, ...)`, `runProjectionsForEvent(..., ctx.db)`, or `"raw" in db ? db.raw : db`) must declare the grant and fetch the runner explicitly. Use `r.job({ name, trigger, escapeHatch: { reason: "<why>" }, handler: async (payload, ctx) => work(ctx.db.unsafeRaw("<why>")) })`; keep the `unsafeRaw` call inside the inline `handler` next to `escapeHatch` so `guard-escape-hatch-declared` recognizes the declaration. `r.systemScope()` features use `ctx.systemDb.unsafeRaw(reason)` instead. WARNING: a job that is not migrated but passes a foreign `where.tenantId` through `ctx.db` does not fail; the filter silently narrows it to the job's own tenant (`SYSTEM_TENANT_ID` for tenant-less cron jobs), so cross-tenant sweeps silently read nothing. Audit every cross-tenant job. Hand-built `JobContext` objects in tests need `db: createTenantDb(conn, tenantId)` (plus `systemDb` for systemScope jobs). Direct callers of `rotateJob`/`sweepOrphanedDerivativesJob` pass the raw connection as the third argument.

### secrets

**rotateJob takes the raw DbConnection as a third argument; the rotate job declares escapeHatch (fw#2914).**

JobContext.db is now a tenant-filtered TenantDb. Rotation re-encrypts every tenant's secrets, so the `rotate` registration declares `escapeHatch` and passes `ctx.db.unsafeRaw(reason)` to `rotateJob(payload, ctx, db)`.

**Migration:** Direct callers of the exported `rotateJob` pass the raw `DbConnection` as the third argument. Apps that only mount the feature need no change.

## 0.274.0

### framework-core

**A searchable reference field targeting an encrypted/PII labelField now fails boot unless that label is itself searchable.**

A searchable reference field can now match a search term against a target row's label even when that label is encrypted or personal data — the match runs through the target entity's own search index instead of the plain-text lookup used for a readable label, which could never match ciphertext and always returned zero matches. As with the plain-text lookup, an unusually large number of index matches drops the match clause instead of silently returning an incomplete page. A matched target row is also checked against the target entity's own read access for the current user, so a match can never surface a row the user could not otherwise see.

**Migration:** A searchable reference field whose target label is encrypted or personal data, but is not itself marked searchable (with fuzzy matching enabled if it also carries a personal-data annotation), now fails to boot instead of silently never matching at request time. Mark the target's label field searchable — with fuzzy matching if it holds personal data, so it is indexed for search — or remove the searchable flag from the reference field if the label was never meant to be searched.

## 0.272.0

### framework-core

**r.step.read.findOne/read.findMany now tenant-filter by default; cross-tenant reads need unsafeAllTenants + escapeHatch (fw#2914).**

`r.step.read.findOne`/`r.step.read.findMany` no longer read through the raw `DbRunner` bound to `ctx.db` (`tenantDbRunner(ctx.db)`, which bypassed every tenant filter). They now call `selectMany(ctx.db, table, where, opts)` — `ctx.db` is a `TenantDb`, so the same `TenantDb.selectMany` tenant filter that `ctx.db` method-form reads already apply now also applies here: own tenant + `SYSTEM_TENANT_ID` reference rows, and a caller-supplied `where.tenantId` outside that scope is narrowed away instead of passed through. Both steps gain an optional `unsafeAllTenants: { reason: string }` argument; when set, the step reads through `ctx.systemDb.unsafeRaw(reason)` (`r.systemScope()` features, already granted by the feature's own systemScope) or `ctx.db.unsafeRaw(reason)` otherwise — the latter throws `AccessDeniedError` unless the write/query handler declares `escapeHatch: { reason }` — and reports an `"unsafe-raw"` escape-hatch audit event, same as any other `ctx.db.unsafeRaw` use. Inside an `r.systemScope()` handler `ctx.db` stays a fail-closed guard, so a read step there without `unsafeAllTenants` still throws `InternalError` (the message now points at `ctx.systemDb`).

**Migration:** No change needed for a read step that only ever reads within the caller's own tenant — it now gets the same tenant filter `ctx.db` method-form reads already had, and a `where.tenantId` for a foreign tenant is silently narrowed to the caller's own scope instead of leaking rows. A read step that intentionally reads across tenants must add `unsafeAllTenants: { reason: "<why the tenant filter cannot apply>" }` to the step AND `escapeHatch: { reason }` (same reason) to the owning write/query handler (or run the step inside an `r.systemScope()` feature, where the grant already exists). No codemod — cross-tenant read-step usage is expected to be rare and needs a real reason per call site.

**ctx.queryAsMember runs the queried handler inside a Postgres READ ONLY transaction — ctx.db and ctx.db.unsafeRaw writes fail (fw#2902).**

`executeQuery` (`pipeline/dispatch-query.ts`) runs every query whose SessionUser has `origin: "member-resolution"` through `runInMemberReadOnlyTransaction` (`pipeline/member-read-only-transaction.ts`): the handler context, the handler, its postQuery hooks and the field-read filter execute inside a savepoint whose first statement is `SET TRANSACTION READ ONLY`. The savepoint is always rolled back — a released one would leave the caller's transaction read-only. With a caller transaction (write handler, in-transaction hook) the savepoint nests into it; without one (query handler, job, `dispatcher.createMemberReader`) the framework opens a pool transaction around the savepoint, holding one connection for the handler's runtime — nested queries' feature/trial gates and rate limits still use their own resolvers, so many concurrent member reads need pool headroom. Inside the subtransaction Postgres rejects switching back via `SET TRANSACTION READ WRITE` (SQLSTATE 25001). Nested `ctx.query` calls inherit the read-only handle; `ctx.queryAs` is now denied for a resolved member principal like the other identity switches (`member_resolution_read_only`), so it cannot reach a context with a writable `dbOutsideTransaction`. Every write — `ctx.db.insertOne`/`updateMany`/`deleteMany`, `ctx.db.unsafeRaw(...)` SQL, `SELECT ... FOR UPDATE/SHARE`, `nextval()`, temp tables — fails with SQLSTATE 25006, surfaced as `AccessDeniedError` (`details.reason` `member_resolution_read_only`, the PG error as `cause`). Feature gate, rate limit, access check and payload validation still run before the transaction opens; membership, principal and auth-claims resolution keep running on the root connection outside it. Handler code that deliberately issues transaction control (`COMMIT`, `RELEASE SAVEPOINT`, `SET SESSION CHARACTERISTICS`) through `unsafeRaw` is not covered — `unsafeRaw` already requires an `escapeHatch` declaration. Top-level `dispatcher.query` and HTTP queries of ordinary users are unchanged.

**Migration:** Find query handlers reached via `ctx.queryAsMember(userId, qn, ...)` (including handlers they call with `ctx.query`) and check them for database side effects: `ctx.db` inserts/updates/deletes, write SQL through `ctx.db.unsafeRaw`, row locks, sequences, temp tables, `ctx.queryAs` calls, or catching a failed statement and continuing (a failed statement now aborts the enclosing transaction). Move such side effects into a write handler called by the original caller, or read the data without writing. Code branching on the raw Postgres error from such a write must branch on `details.reason === "member_resolution_read_only"` instead. Audit at release: bundled-features 0 sites, solon 0, offlot-app 0, money-horse 0, kumiko-enterprise 0 (no consumer calls ctx.queryAsMember yet).

## 0.271.0

### framework-core

**ctx.queryProjection(..., { unsafeAllTenants: true }) needs r.systemScope() or escapeHatch; EntityTableMeta projection tables are now tenant-filtered (fw#2913).**

`ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })` previously lifted the tenant filter for anyone who passed the option, with no declaration required. It now goes through the same gate as `ctx.queryAs`/`ctx.writeAs`/`ctx.queryAsMember` (`pipeline/system-identity-switch.ts`): a new `createGatedProjectionReader(callerLabel, hasGrant, ungated, audit)` wraps the reader `dispatch-shared.ts`'s `buildHandlerContext` builds, and only checks `unsafeAllTenants === true` — a call without that option is never gated. Without a grant it throws `AccessDeniedError` with the new reason `unsafe_all_tenants_denied` (`FrameworkReasons.unsafeAllTenantsDenied`, docs entry in `errors/i18n/{en,de}.yaml`). With a grant — the handler's `r.systemScope()` feature or a declared `escapeHatch: { reason }` — it reports exactly one new `EscapeHatchKind` `"unsafe-all-tenants"` event through the existing escape-hatch audit sink (added to `escapeHatchUsedSchema.kind` in `bundled-features/audit`). Inside a lifecycle hook, `withHookEscapeHatchGrant`/`bindHookEscapeHatchGrant` re-gate `ctx.queryProjection` the same way they already re-gate `queryAs`/`writeAs`/`queryAsMember` — only the hook's own `escapeHatch` grants it, never the enclosing handler's, and (like the identity-switch gate) not even the handler's own `r.systemScope()` feature carries into a hook without its own `escapeHatch`. New internal helpers in `pipeline/system-identity-switch.ts` — `ProjectionReader` (`HandlerContext["queryProjection"]`), `createGatedProjectionReader`, `unsafeAllTenantsDenied` — are not re-exported from `pipeline/index.ts`. `defineProjectionQueryHandler` (`engine/entity-handlers.ts`) gained an `escapeHatch?: EscapeHatchDeclaration` option, forwarded onto the returned `QueryHandlerDef`. Separately, `hasTenantColumn` (`db/tenant-db.ts`, already used by `TenantDb`'s other escape hatches) is now exported from that module — an internal framework/pipeline helper, not re-exported from `db/index.ts` — and `ctx.queryProjection`'s auto-filter uses it instead of reading `projTable["tenantId"]` directly — a projection table built from a plain `EntityTableMeta` (`defineUnmanagedTable`/`deriveEntityTableMeta`, no drizzle `SchemaTable` symbols) has no `tenantId` JS property, so its rows were never tenant-filtered before this fix even though the table has a `tenant_id` column.

**Migration:** A handler or hook that calls `ctx.queryProjection(qualifiedName, { unsafeAllTenants: true })`, or registers `defineProjectionQueryHandler(name, qn, { unsafeAllTenants: true, ... })`, now needs `r.systemScope()` on its feature or `escapeHatch: { reason: "<why this handler needs every tenant's rows>" }` declared on the write/query/stream handler (or on the `r.hook(...)` call, if the read happens inside a hook) — code branching on `details.reason` for the resulting denial must also accept `unsafe_all_tenants_denied`. A hook inside an `r.systemScope()` feature does NOT inherit that grant for `unsafeAllTenants` either (same rule as `ctx.queryAs`/`ctx.writeAs`): it needs its own `escapeHatch: { reason }` on the `r.hook(...)` call. Separately, any projection built from `defineUnmanagedTable`/`deriveEntityTableMeta` (an `EntityTableMeta` with a `tenant_id` column, not wrapped in `table()`'s `SchemaTable`) is now tenant-scoped on every plain `ctx.queryProjection(qualifiedName)` call, where it previously returned every tenant's rows unfiltered. A handler that relied on that bug to read cross-tenant now needs the `unsafeAllTenants: true` opt-in plus a grant, same as above. No codemod — both call sites are rare enough to review by hand.

**systemScope handlers default to a per-tenant+handler rate limit; nested-write refuses a foreign-tenant/foreign-owner parent row (fw#2861).**

`r.systemScope()` write/query/stream handlers that declare no `rateLimit` now default to `{ per: "tenant+handler", limit: 600, windowSeconds: 60 }` — only when `context.rateLimit` is already configured, and never for a SYSTEM-identity caller. `per: "tenant+handler"` (not `"tenant"`) so one hot handler cannot starve every other systemScope handler's shared tenant quota. `RateLimitDeclaration` (`RateLimitOption | RateLimitDisabled`) replaces `RateLimitOption` on `WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef` (and their `*Definition`/inline-options counterparts): `rateLimit: { disabled: true, reason: "..." }` opts a handler out of both the explicit and default limit; the boot validator rejects an empty reason. `enforceRateLimit` (`pipeline/dispatch-shared.ts`) takes a new `isSystemScope: boolean` 5th param; the three dispatch call sites now call it unconditionally. `computeHasRateLimitedHandler`/`wantsL3` stay limited to explicit, non-`disabled` `rateLimit` declarations on purpose. 40 bundled systemScope handlers newly get the default; 7 self-scoped read handlers hit on every page load (traffic scales with signed-in users, not tenant ops) declare `rateLimit: { disabled: true, reason }` instead — `user:query:user:me`, `tenant:query:me`, `config:query:{cascade,values,schema,readiness}`, `delivery:query:preferences` (full per-feature list in the systemscope-rate-limit-nested-ownership changeset). None of the 47 was anonymous-accessible, so no opt-out was required for that reason. Separately, `executeNestedWrite` now refuses to attach nested children to a parent row a custom (non-executor) `:create` handler returned without independently verifying ownership: a new `isForeignTenantParentRow` check refuses a returned row from another tenant (skipped for `r.systemScope()` handlers), and `checkWriteFieldOwnership(parentEntity, parentRow, user)` refuses a same-tenant row whose ownership-bound field does not resolve to the caller — both roll back the whole nested write.

**Migration:** If your app configures a RateLimitResolver (the rate-limiting feature, an explicit `context.rateLimit`, or L1/L2 middleware options that auto-wire one), every `r.systemScope()` write/query/stream handler without its own `rateLimit` is now limited to 600 calls per tenant per handler per 60s for non-SYSTEM callers. Declare an explicit `rateLimit: { per, limit, windowSeconds }` on a handler that legitimately needs more, or `rateLimit: { disabled: true, reason: "..." }` for a per-user self-scoped read whose traffic scales with signed-in users rather than tenant operations (L1 IP limits still apply). Separately, a custom `<entity>:create` handler used under a `nestedWrite: true` relation must return the row it just created for the calling user: returning another tenant's row, or a row whose ownership-bound field(s) do not resolve to the caller, now fails the whole nested write with `access_denied` before any child rows are written.

**`TenantDb.raw` is removed — framework infrastructure gets the connection injected (fw#2860).**

`TenantDb.raw` (`@cosmicdrift/kumiko-types/tenant-db-types`) no longer exists. Framework infrastructure that used to read it — the event-store executor's CRUD verbs, `read.findMany`/`read.findOne`/`unsafeProjectionDelete`/`unsafeProjectionUpsert` engine steps, the entity-convention `crossTenant` handlers, `UncheckedSystemDb.unsafeRaw`, the MSP consumer's per-event `apply()` in `api/server.ts`, and `db/assert-exists-in.ts`'s TenantDb duck-type — now resolves the bound `DbRunner` through a new framework-private module `db/tenant-db-runner.ts` (`bindTenantDbRunner`/`tenantDbRunner`, a `WeakMap<TenantDb, DbRunner>` keyed by the exact object `createTenantDb` built; not re-exported from `db/index.ts` or any package-exports entry, so feature code cannot import it). `asRawClient` (`bun-db/query.ts`) no longer unwraps a `.raw`-shaped TenantDb; it throws when handed one, same as the raw-SQL helpers built on it (`countWhere`, `transaction`, `runInSavepoint`/`runInSavepointIfSupported`, `executeRawQuery`/`executeRawQueryRead`, `upsertOnConflict`, `incrementCounter`, `insertMany`, `deleteManyBatched`) — they no longer accept a `TenantDb` at all. `tenantDbDelegate`'s TenantDb duck-type check no longer looks for `.raw`. `pipeline/projections-runner.ts`'s `runProjections(result, registry, runner)` takes an explicitly-resolved `DbRunner | undefined` (the dispatcher's `resolveDbSource(ctx, tx)`, threaded through `runLifecycle`) instead of reaching into `ctx.db.raw` / `ctx.systemDb.acknowledgeCrossTenant(...).raw` itself; it throws `InternalError` if `result.event` is set but no runner was resolved. `bundled-features/tenant/seeding.ts`'s `fireEntityPostSave`'s optional 4th argument changed from a bare `tenantId` to `{ tenantId, db }` — the caller (already holding a legitimately-declared runner) hands it in instead of the helper trying to pull one out of `context.db`. The boot validator now also rejects a `tenancy: "global"` entity whose owning feature does not declare `r.systemScope()` — a convention write on such an entity would otherwise still dispatch in tenant-mode. `packages/bundled-features/src/jobs/handlers/list.query.ts` switched from `ctx.systemDb.acknowledgeCrossTenant(reason)` to `ctx.systemDb.unsafeRaw(reason)` since it calls `countWhere` directly.

**Migration:** `ctx.db.raw` → `ctx.db.global(table)` for `tenancy: "global"` tables, otherwise `ctx.db.unsafeRaw(reason)` with `escapeHatch: { reason }` on the handler/hook; r.systemScope() features `ctx.systemDb.unsafeRaw(reason)`. Raw SQL helpers (countWhere, transaction, runInSavepoint*, executeRawQuery*, upsert*, incrementCounter, insertMany, deleteManyBatched) no longer accept a TenantDb. Hand-built TenantDb objects passed to the EventStoreExecutor must be created via createTenantDb. `tenancy: "global"` entities must live in an r.systemScope() feature. Custom callers of fireEntityPostSave pass `{ tenantId, db }` as 4th argument.

**Boot validator requires every screen to be reachable from the app's nav tree.**

`validateScreens` now rejects a screen that has no own `nav`, no standalone `r.nav()` pointed at it anywhere in the composed feature set, and no resolvable parent list (`listScreenId`, or a rowAction/toolbarAction/drawer navigate target from an `entityList`/`projectionList`, or — for `entityEdit` — a same-entity `entityList`) — unless it declares `dormant: true`. `dormant` (previously only on `CustomScreenDefinition`) is now on every screen type. The resolution logic is the same `resolveNavParentScreen` the renderer's breadcrumb/NavTree already used, moved into `@cosmicdrift/kumiko-framework/engine/screen-helpers.ts` (re-exported through `ui-types`) instead of a second copy, and widened to also recognize toolbarActions and drawer-kind targets, not just entityList rowActions. The check is skipped when the composed feature set registers no nav entries anywhere at all (an isolated feature/recipe/test boot has no nav tree to be orphaned from).

**Migration:** A screen that boots inside an app with at least one nav entry somewhere, but isn't itself reachable, now fails boot with "has no nav entry and no resolvable list". Fix by declaring `listScreenId` (or a rowAction/toolbarAction navigate target from a list screen pointed at it), adding a standalone `r.nav()` for it, or setting `dormant: true` if it's intentionally reachable only via a direct link/redirect or a consuming app's own `r.nav()` (the established pattern for app-placed settings-area screens like `tenant-list`/`user-list`/`tier-admin`/personal-access-tokens' list/`profile`, now applied consistently across bundled-features).

## 0.269.0

### framework-core

**`openToAll: true` is removed — every openToAll grant now requires { reason } (fw#2858).**

`OpenToAllAccessRule` (`@cosmicdrift/kumiko-types/handlers`) no longer accepts `true`; only `OpenToAllDeclaration` (`{ reason: string; personalData?: "tenant-members" }`) satisfies it, so `{ openToAll: true }` no longer type-checks. `isOpenToAllGranted` denies `true` from untyped sources (pattern JSON, Designer) the same way it already denied a malformed object — a bare `true` reaching it now returns `false` instead of granting access. The boot validator (`engine/boot-validator/access-declarations.ts`) rejects an untyped `openToAll: true` access declaration with an error pointing at `{ reason }` instead of registering the handler. The pattern-library Designer access field (`shared-fields.ts` `accessRuleField`) is now a required text input on `access.openToAll.reason` instead of a boolean toggle, so the Designer can only ever produce the object form. `build-config-feature-schema.ts` synthesizes `{ openToAll: { reason: "config key declares the \"all\" role, so every signed-in user of the tenant may read/write it" } }` for a config key whose roles include `"all"`, instead of `{ openToAll: true }`. `boot-validator/nav.ts` and `renderer-web/app/create-app.tsx` switched from `"openToAll" in access` to `isOpenToAllGranted(access)`, so a malformed or `true` rule is no longer treated as a visible screen/workspace. The feature-AST extractor now also extracts `escapeHatch: { reason }` on write/query handlers (`extractors/handlers.ts`) and on `r.hook` options (`extractors/hooks.ts`), round-tripped through render/patch the same way `access`/`rateLimit` already were.

**Migration:** Replace every `openToAll: true` with `openToAll: { reason: "<who may call it and why that is safe without a role>" }`, adding `personalData: "tenant-members"` where the boot validator requires it for a write handler accepting unbound personal data. Pattern-library or Designer-authored JSON that still has `openToAll: true` must be re-saved with a reason before it type-checks or passes boot. `kumiko-upgrade --apply` runs the migrate-open-to-all codemod automatically, rewriting test files to the default reason and listing every non-test site for manual review; run `bun packages/framework/src/scripts/codemod/migrate-open-to-all.ts --test-reason "<text>" <paths>` directly to override the default test reason.

**ctx.queryAs/ctx.writeAs to any identity other than the caller itself need r.systemScope() or escapeHatch (fw#2876).**

The identity-switch gate from fw#2859 now applies to every target, not only SYSTEM (`isSystemIdentitySwitchAllowed` is replaced by `isIdentitySwitchAllowed(caller, asUser, hasGrant)` in `pipeline/system-identity-switch.ts`; `createGatedIdentitySwitch` takes the caller as second argument). Without a grant, `HandlerContext.queryAs`/`writeAs` only accept the caller itself: same `id`, same `tenantId`, same `origin`, equal `claims`, and roles that are a subset of the caller's roles (`sid`, `pat`, `timezone`, `locale` may differ). Any other target — a different user id, a different tenant, extra roles, changed claims, a stripped `origin` — throws `AccessDeniedError` (code `access_denied`, `details.reason` `identity_switch_denied`, no target id/tenant in the error); SYSTEM targets keep `system_identity_switch_denied`. The grant is the same as before: the calling handler's `r.systemScope()` feature or `escapeHatch: { reason }` on the write/query/stream handler, or the hook's own `r.hook(..., { escapeHatch })`. It stays non-transitive, hooks never inherit it, extension hooks and `r.authClaims` hooks have no declaration site (their `queryAs` only reaches the caller itself), and a hook's caller is taken from the dispatcher-built gate, never from `ctx.user`. `JobContext.queryAs`/`writeAs`, top-level `dispatcher.write`/`query`, `ctx.queryAsMember` and `ctx.resolveActiveMembership` are unchanged. `r.step.callFeature({ as })` goes through the gated `ctx.writeAs` and needs the handler's `escapeHatch` for a foreign `as`.

**Migration:** Find every `ctx.queryAs(user, ...)`/`ctx.writeAs(user, ...)` (also via helpers that receive `ctx`, and `r.step.callFeature({ as })`) whose user is not `createSystemUser(...)`. If the user is `event.user`/`query.user` or a copy with fewer roles, nothing to do. If it is another user, another tenant (e.g. `{ ...event.user, tenantId: other }`) or adds roles, declare `escapeHatch: { reason: "<why this handler acts as that identity>" }` on the write, query or stream handler (or on the `r.hook(...)` call), move the call into an `r.systemScope()` feature or a job, or use `ctx.queryAsMember(userId, ...)` for reads as a stored tenant member. Code branching on `details.reason` for these denials must also accept `identity_switch_denied`. Audit at release: bundled-features 0 sites, solon 0, offlot-app 0, kumiko-enterprise 0 (ai-agent tool dispatcher passes the caller itself).

## 0.267.0

### framework-core

**ctx.db.unsafeRaw(reason) gated by escapeHatch, tenancy: "global" invariants, bundled features migrated off ctx.db.raw (fw#2858).**

`TenantDb.unsafeRaw(reason)` returns the unfiltered `DbRunner` only when the calling write or query handler declares `escapeHatch: { reason }` (lifecycle hooks: `r.hook(..., { escapeHatch })`; a hook no longer inherits the handler's grant, same as the #2859 SYSTEM identity-switch gate). Without a declaration it throws `AccessDeniedError`; an empty reason throws `Error`. `r.systemScope()` features keep using `ctx.systemDb.unsafeRaw(reason)`. `TenantDb.raw` stays deprecated until fw#2860. `createTenantDb`'s 7th parameter changed from an `EscapeHatchDeclaration` to `TenantDbGrants` `{ globalWrites?, unsafeRaw? }`; `withUnsafeRawGrant(tenantDb, grant)` rebinds the unsafeRaw grant. `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant` are renamed to `bindHookEscapeHatchGrant`/`withHookEscapeHatchGrant`. Global tenancy: a `tenancy: "global"` entity must declare `systemStream: true` (boot validator + executor) and its create/update payloads may not carry a non-SYSTEM `tenantId`; tenant-mode `insertOne` into a global table with a `tenant_id` column and `db.global(table)` writes with a non-SYSTEM `tenantId` are rejected; `defineUnmanagedTable({ tenancy: "global" })` rejects a `tenant_id` column; new `declareGlobalTenancy(table)` declares a plain `table()` store without `tenant_id` as global. Bundled features: `userEntity` is `tenancy: "global"`, `store_global_feature_state` is declared global, and every bundled `ctx.db.raw` call site now uses `ctx.db.global(table)`, a filtered `ctx.db` method, or `ctx.db.unsafeRaw(reason)` with an `escapeHatch` on the handler. Handlers that call the auth-mfa `mfaStatusChecker`/MFA code verifier callbacks, handlers wrapped by cap-counter `withStockCap` (declares it automatically) and callers of the custom-fields quota/field-access query helpers now need that declaration.

**Migration:** Replace each `ctx.db.raw` use: reads of a `tenancy: "global"` table → `ctx.db.global(table).selectMany/fetchOne(...)`; reads/inserts whose where/values only use the caller's own tenantId → `ctx.db.selectMany/fetchOne/insertOne(table, ...)` (method form); everything else → `ctx.db.unsafeRaw("<what is read/written and why the tenant filter cannot apply>")` plus `escapeHatch: { reason }` on the write/query handler definition or in the `r.hook` options. Generic reasons (todo, legacy, migration) fail infra#788. `kumiko-upgrade --apply` runs the migrate-db-raw codemod automatically, rewriting the global-table and own-tenant cases and listing the remaining sites for manual review. Custom handlers calling `mfaStatusChecker`/the MFA code verifier or the custom-fields query helpers must declare `escapeHatch`. Direct `createTenantDb(..., escapeHatch)` calls pass `{ globalWrites: escapeHatch }` (and `unsafeRaw` if needed). Rename imports of `bindHookIdentitySwitchGrant`/`withHookIdentitySwitchGrant`. `defineUnmanagedTable({ tenancy: "global" })` definitions must drop their `tenant_id` column; `tenancy: "global"` entities must add `systemStream: true`.

## 0.266.0

### framework-core

**`publicIntake` is removed; an openToAll write handler declares unbound personal data with `openToAll: { reason, personalData: "tenant-members" }`.**

`OpenToAllAccessRule.publicIntake` (`@cosmicdrift/kumiko-types/handlers`) no longer exists. `OpenToAllDeclaration` gains `personalData?: OpenToAllPersonalData`, a named union (currently only `"tenant-members"`, exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`): signed-in tenant members may write personal data that no owner rule binds to the caller. The deprecated `openToAll: true` form cannot carry it. `validateAccessDeclarations` requires `personalData: "tenant-members"` for a write handler with `openToAll` whose input accepts a personal-data field that is not owner- or self-bound, rejects `personalData` on query and stream handlers, and rejects any other `personalData` value from untyped sources. `openToAll` never admits anonymous callers, so there is no public-intake value; anonymous personal-data intake is tracked separately. The feature-AST extractor reads `openToAll.personalData` and no longer reads `publicIntake`. Bundled `user:update` now declares `openToAll: { reason, personalData: "tenant-members" }`: `userEntity` has no entity-level `access.write`, and privileged actors may edit any user.

**Migration:** Replace `access: { openToAll: { reason: "..." }, publicIntake: true }` (or `openToAll: true, publicIntake: true`) with `access: { openToAll: { reason: "<why any signed-in tenant member may write this personal data>", personalData: "tenant-members" } }`. Handlers whose personal-data fields are owner- or self-bound through the entity's `access.write` need no declaration. A `publicIntake` key left in an untyped access object (pattern JSON, Designer) is ignored, so the handler fails boot until migrated. No known consumer used `publicIntake`.

**The openToAll personal-data boot check now finds personal-data fields nested anywhere in a write handler's input schema.**

`validateAccessDeclarations` (`engine/boot-validator/access-declarations.ts`) previously compared only the top-level keys of a `z.object` input schema (unwrapping `.optional()`/`.nullable()`/`.default()`) against the handler entity's personal-data fields (pii / userOwned / recordOwned); any other schema shape was skipped. It now collects object keys at every depth via `collectZodObjectKeys` (`engine/boot-validator/zod-shape.ts`): through `z.intersection`, `z.union`/`z.discriminatedUnion`/`z.xor`, `.transform()`/`z.preprocess()`/`.pipe()`/codecs, `.optional()`/`.nullable()`/`.default()`/`.prefault()`/`.nonoptional()`/`.readonly()`/`.catch()`/`z.lazy()`, nested objects (e.g. the update shape `{ id, version, changes: {...} }`), arrays, tuples and records. An update handler that accepted the same personal-data field as its create handler used to pass boot while the create handler failed. A schema with more than 10000 distinct nodes (typically a `z.lazy()` getter that returns a new schema on every call) throws at boot instead of looping. Which entity's fields are compared is unchanged: the handler's mapped entity, or every entity of the feature for an unmapped handler.

**Migration:** A write handler with `openToAll` whose input accepts a personal-data field of its entity inside an intersection, union, pipe/transform, nested object (update `changes`), array or record now fails boot like a top-level field always did. Known: kumiko-enterprise kumiko-credit `update` (intersection) and `bauspar:update` (`changes.name`) under `trustDomain: "tenant"` or with an `access` map that grants any role `"all"`. For each affected handler, bind the entity's rows to the caller (owner-binding entry in this release), restrict `access` to roles, or declare `openToAll: { reason: "...", personalData: "tenant-members" }`.

## 0.263.0

### framework-core

**ctx.queryAs/ctx.writeAs with a SYSTEM identity only from r.systemScope(), jobs, or a handler/hook declaring escapeHatch (fw#2859).**

Switching identity to SYSTEM (a SessionUser whose id is SYSTEM_USER_ID or whose roles contain SYSTEM_ROLE, e.g. `createSystemUser(...)`) through `HandlerContext.queryAs`/`writeAs` now throws `AccessDeniedError` (code `access_denied`, `details.reason` `system_identity_switch_denied`) unless the calling handler belongs to an `r.systemScope()` feature or declares `escapeHatch: { reason }`. The grant is looked up per handler type in the registry and never propagates: a handler reached through another handler's `writeAs(SYSTEM)` needs its own declaration for its own SYSTEM switches. `queryAs`/`writeAs` with a non-system user stays ungated and runs under that user's access. `JobContext.queryAs`/`writeAs` and top-level `dispatcher.write`/`query` (es-ops `systemWriteAs`, extraRoutes) stay ungated. Lifecycle hooks no longer inherit the grant of the handler they fire on: `r.hook(type, target, fn, { escapeHatch })` is the per-hook declaration; hooks contributed through `r.extendsRegistrar` are always denied; `r.authClaims` hooks' `queryAs` denies SYSTEM. `escapeHatch` is now also accepted on query handlers (`QueryHandlerDef`/`QueryHandlerDefinition`/`r.queryHandler` options); the boot validator rejects an empty reason there too, and `r.hook` throws at registration on an empty reason. Static boot-time detection of SYSTEM switches is not possible (handlers are closures), so enforcement is at runtime.

**Migration:** Find every `ctx.queryAs(...)`/`ctx.writeAs(...)` whose user is `createSystemUser(...)` or otherwise carries `SYSTEM_ROLE` (also indirectly through helpers that receive `ctx`). For each, add `escapeHatch: { reason: "<which SYSTEM lookup/write and why the caller's own identity cannot do it>" }` to the write or query handler definition that ends up calling it (`r.writeHandler`/`r.queryHandler` options, `defineWriteHandler`/`defineQueryHandler`), or move the logic into an `r.systemScope()` feature or a job when that is the correct owner. Handlers of `r.systemScope()` features need nothing. A lifecycle hook doing a SYSTEM switch through its runtime HandlerContext passes `{ escapeHatch: { reason } }` as `r.hook`'s options (postSave/postDelete: next to `phase`). `escapeHatch` on a write handler also permits `ctx.db.global()` writes. Consumer call sites to audit at release: solon 15, offlot-app 14, kumiko-enterprise 5 `queryAs`/`writeAs` sites.

**Forms are prefilled from URL query parameters only for fields a declarative `navigate` action declares as `params` (fw#2852).**

`buildAppSchema` now derives `urlPrefillFields` per actionForm/secretMint/entityEdit-create screen from every navigate `params` that targets it — entityList/projectionList rowActions, projectionDetail/entityEdit actions, relatedList rowActions, and projectionDetail metrics; a form nothing targets takes nothing from the URL. Previously any query parameter matching a field name was taken, so a crafted link could seed e.g. an IBAN or e-mail field. Declared params keep working. `sensitive` and `format: "password"` fields are still never prefilled — not from the URL, an allowlist, or a handoff.

**Migration:** Code that prefills a form via `nav.navigate` + `nav.setSearchParams` without a declared `params` (known: publicstatus `custom-field-list`, phronexsis `driver-map-node-panel`, kumiko-enterprise ai-agent `openForm` client tool / `agentPrefill=1`) must switch to a declared `navigate` action with `params`, or — for programmatic prefill — to `useNavigateWithInitialValues()` from `@cosmicdrift/kumiko-renderer`. No codemod.

## 0.261.0

### framework-core

**access is required on handler definitions; openToAll accepts { reason } (+ publicIntake) (fw#2855).**

`WriteHandlerDef`/`QueryHandlerDef`/`StreamHandlerDef`.access (`@cosmicdrift/kumiko-types/handlers`), `WriteHandlerDefinition`/`WriteHandlerInput`/`QueryHandlerDefinition`/`StreamHandlerDefinition`.access, `EntityHandlerOptions.access`, and the `r.writeHandler`/`r.queryHandler`/`r.streamHandler` positional `options` param are now required — a handler with no access rule fails to compile instead of silently registering unreachable (previously the boot-validator caught it at runtime). `registerEntityCrud` throws at registration when an enabled verb resolves no access (`write.access`/`read.access`/`verbAccess.<verb>` all unset) — was previously a boot-validator throw. `AccessRule.openToAll` accepts `{ reason: string }` (plus optional `publicIntake: true`); `true` still compiles (deprecated pre-#2855 form, tracked for removal in fw#2854's call-site migration) but a new boot-validator (`engine/boot-validator/access-declarations.ts`) rejects an empty `openToAll.reason`, an empty `escapeHatch.reason`, `publicIntake` on a query/stream handler, and — the main new catch — a write handler with `openToAll` that accepts a personal-data field (pii/userOwned/recordOwned) in its input schema without `publicIntake: true`. Code that read `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)` (`@cosmicdrift/kumiko-types/handlers`, also re-exported from `@cosmicdrift/kumiko-framework/engine` and `/ui-types`), which handles both the `true` and `{ reason }` forms.

**Migration:** Add `access` to every handler definition: `r.writeHandler`/`r.queryHandler`/`r.streamHandler` object- and positional-form options, `defineWriteHandler`/`defineQueryHandler`/`definePagedQueryHandler`/`defineProjectionQueryHandler` options, `defineEntityCreate/Update/Delete/Restore/List/DetailHandler` options, and `registerEntityCrud`'s `write.access`/`read.access` (or per-verb `verbAccess`). Replace `openToAll: true` with `openToAll: { reason: "..." }` going forward — `true` still compiles but is deprecated (fw#2854 tracks the 471-site call-site migration; new code should use the object form). A write handler that already used `openToAll` and accepts a PII field now fails boot unless it also declares `publicIntake: true` (any authenticated user may legitimately submit that data) or is restricted to roles instead. Any code reading `access.openToAll` as a boolean must switch to `isOpenToAllGranted(rule)`.

## 0.259.0

### sessions

**sessions:query:user-session:mine returns the paged envelope { rows, nextCursor }; new self-service my-sessions screen (fw#2844).**

The query backs the new `my-sessions` projectionList (open to every signed-in user): the caller's live sessions with a per-row revoke (hidden on the current session) and "sign out all other devices". Exported id SESSION_MINE_SCREEN_ID. Server-side scoping to the caller is unchanged.

**Migration:** Breaking for direct callers of `sessions:query:user-session:mine`: read `data.rows` instead of treating `data` as the array (`nextCursor` is always null). Account-security custom screens built on this query can be replaced by a dashboard with `kind: "screen"` panels on `sessions:screen:my-sessions` and the auth-mfa screens (money-horse#477, publicstatus#435, kumiko-studio#283).

## 0.241.0

### audit

**AuditLogScreen and AuditLogDetailScreen removed; audit-log/audit-log-detail are now declarative screens (fw#2312).**

`audit-log` and `audit-log-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `AuditLogScreen`/`AuditLogDetailScreen` were dead exports the moment the screen definitions switched. The `payload`/`metadata` fields now use the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { AuditLogScreen, AuditLogDetailScreen } from "@cosmicdrift/kumiko-bundled-features/audit/web"` and any `components: { AuditLogScreen: ..., AuditLogDetailScreen: ... }` entry in your `auditClient()`/renderer setup — the bundled feature registers its own `audit-log`/`audit-log-detail` screens now, nothing left for an app to wire.

### jobs

**JobRunsScreen and JobRunDetailScreen removed; job-runs/job-run-detail are now declarative screens (fw#2312).**

`job-runs`/`job-run-detail` render through the generic renderer (`projectionList`/`projectionDetail`) instead of custom React components — the renderer selects a screen by its `screen.type`, not a client component registry, so `JobRunsScreen`/`JobRunDetailScreen` were dead exports the moment the screen definitions switched. Job triggering moved from an inline control on the old custom screen to a new `job-trigger` `actionForm`, opened via a `kind: "drawer"` `toolbarAction` on `job-runs`. `job-run-detail`'s `logs` field now uses the `format: "json"` field-renderer (see framework changelog) instead of a raw escaped-string dump.

**Migration:** Breaking only if you imported these components directly (no shipped consumer app did). Remove `import { JobRunsScreen, JobRunDetailScreen } from "@cosmicdrift/kumiko-bundled-features/jobs/web"` and any `components: { JobRunsScreen: ..., JobRunDetailScreen: ... }` entry in your `jobsClient()`/renderer setup — the bundled feature registers its own `job-runs`/`job-run-detail`/`job-trigger` screens now, nothing left for an app to wire.

### tier-engine

**TierAdminScreen removed; tier-admin is now a declarative actionForm (fw#2312).**

`tier-engine:screen:tier-admin` is now a declarative `actionForm` (a `reference` field for the tenant, a `select` field for the tier) instead of a custom React component: it dispatches `set-tenant-tier` directly, so the renderer's generic form handles tenant lookup, validation and submit. Two behaviors are intentionally not carried over: the current tier of the selected tenant is no longer shown before submit (declarative forms have no dependent-query support), and the success state no longer names the newly assigned tier (a generic actionForm success doesn't surface write-response data). Both are visible again after a page reload / re-navigation — the assignment itself is unchanged.

**Migration:** Breaking only if you imported `TierAdminScreen` directly (no shipped consumer app did — all reference the screen by its qualified id `tier-engine:screen:tier-admin`). Remove `import { TierAdminScreen } from "@cosmicdrift/kumiko-bundled-features/tier-engine/web"` and any `components: { TierAdminScreen: ... }` entry in your renderer setup — the bundled feature registers the `tier-admin` screen itself now, nothing left for an app to wire.

### user-data-rights

**privacy-center is now a declarative screen; userDataRightsClient's privacyCenter.showDeletion option is removed (fw#2312).**

`privacy-center` is now a declarative `projectionDetail` screen instead of a custom React component: the Restriction and Deletion sections render through the generic renderer (`EditFieldsSection` + `actions: RowAction[]`), preserving the original confirmation dialogs (`RowActionWriteHandler.confirm`) and visibility rules (`visible: {field, eq/ne}`) 1:1. The Export section (Art. 20) stays a custom `EditExtensionSection` — it needs polling + a signed-URL download — registered via the new `ClientFeatureDefinition.extensionSectionComponents` under `EXPORT_SECTION_EXTENSION_NAME`. `PrivacyCenterScreen` is a dead export (the renderer selects the screen by `screen.type`, not the client component registry). The single `status` field now renders through the `enumOption` format instead of the raw enum string; `gracePeriodEnd` is hidden when no deletion is pending instead of showing an empty date. Known UI regression, accepted for this pass: the confirm-dialog title is now always the action's `label` (the renderer hardcodes this) — the original's distinct `dialogTitle` copy and its dynamic composed banner sentence (e.g. "Your account will be deleted on {date}") are gone, replaced by the translated `status` label plus a separately labeled `gracePeriodEnd` date.

**Migration:** A declarative screen is registered once and can no longer be toggled per-app on the client: `userDataRightsClient(options)`'s `privacyCenter: { showDeletion }` option is removed. Move the flag server-side instead — replace `createUserDataRightsFeature({})` with `createUserDataRightsFeature({ privacyCenterShowDeletion: false })` (default `true`) — it conditionally omits the Deletion section and its `request-deletion`/`cancel-deletion` actions from the screen definition. Then drop the now-unused `privacyCenter` option from the matching `userDataRightsClient({ privacyCenter: { showDeletion: false } })` call. Known affected consumer: `money-horse` (`src/app/client-features.tsx:74`).

### user-profile

**user-profile now registers its own profile screen (id user-profile:screen:profile); app-side profile screen registrations must be removed (fw#2312).**

`profile` is now a declarative `projectionDetail` screen bound to `user:query:user:me` instead of a custom React component: change-password and change-email stay `EditExtensionSection` components (re-auth flows a declarative action can't express), account deletion (request/cancel via `user-data-rights`, grace period) is now fully declarative fields + `actions: RowAction[]`, preserving the original confirm dialog and `visible: {field, eq/ne}` toggle 1:1. `userProfileClient()` now registers the two extension-section components via `extensionSectionComponents` instead of exposing a `ProfileScreen` component for apps to place in a `components` map. `ProfileScreen` is a dead export. New exports: `ChangeEmailSection`, `ChangePasswordSection` (the two surviving extension components, importable for tests but not meant to be placed manually). Known UI regression, accepted for this pass (same trade-off as `privacy-center`): the deletion confirm-dialog title is now always the action's `label`; the dynamically composed grace-period banner sentence is gone, replaced by a plain `gracePeriodEnd` date field; there is no cancel-deletion success toast.

**Migration:** The bundled feature now registers the `profile` screen itself (id `user-profile:screen:profile`) — an app's own `profile` custom-screen registration collides on boot with a duplicate short-id error. Delete the app-side registration entirely: `r.screen({ id: "profile", type: "custom", renderer: { react: { __component: "UserProfileScreen" } }, access: { openToAll: true } })` has no replacement to write, just remove the call. If you have an `r.nav({ screen: "profile" })` (or any other reference to the app-local `profile` screen id), repoint it at `"user-profile:screen:profile"`. Also remove `components: { UserProfileScreen: ProfileScreen }` from your renderer/client setup and the now-unused `ProfileScreen` import — the client no longer exposes that component. Known affected consumers (not modified here, out of this PR's scope): `money-horse` and `offlot-app` both currently register their own `profile` custom screen this way.

## 0.235.0

### framework-core

**UnprocessableOpts.details can no longer carry its own `reason` key (fw#2460).**

UnprocessableError builds its `details` as `{ ...opts?.details, reason }`, so `reason` was always owned by the ctor's first positional argument — but nothing stopped a caller from also putting `reason` inside `opts.details`, where it was silently overwritten. `UnprocessableOpts.details` is now typed `Readonly<Record<string, unknown>> & { readonly reason?: never }`, so that redundant key is now a compile-time error (TS2322) instead of a silent no-op. This was shipped in #2460 without a changeset or changelog entry, which is what this entry retroactively fixes.

**Migration:** Remove `reason` from any `details: { ... }` object literal passed to `new UnprocessableError(reason, { details: { ...} })` — the value is unchanged, it now flows only through the first positional argument. Run the codemod, or delete the property by hand where it isn't statically removable (the codemod reports those sites with file:line and a reason).

## 0.209.1

### framework-core

**Job runs no longer go through the event store; read_job_runs table renamed to store_job_runs (fw#2243).**

Job runs (jobRun) no longer go through the event store. Every job execution used to append a run-started + run-completed/run-failed event replayed through two inline projections — in the busiest apps this was ~99% of all events ever written, for data nothing else replays or subscribes to. onJobStart/onJobComplete/onJobFailed now write straight into the (renamed) store_job_runs / store_job_run_logs tables, with a new daily jobs:job:retention-cleanup job (retentionDays, default 30) purging old rows so the tables don't grow forever.

**Migration:** Breaking for raw-SQL consumers: the table is renamed read_job_runs → store_job_runs (store_job_run_logs is unchanged). The migration drops read_job_runs outright — old run history is not preserved, it was operational/debug data, not a system of record. Apps that only use the shipped job-runs-screen/jobs:query:* handlers are unaffected; apps with a raw SQL dependency on read_job_runs need a follow-up on their side.

## 0.202.0

### personal-access-tokens

**personal-access-tokens: `write:create` now requires `currentPassword` (+ `mfaCode` if MFA enrolled) (e91d4cb).**

`personal-access-tokens:write:create` now requires `currentPassword` (verified against the caller's password hash) before minting a token, and rejects when the caller has MFA enrolled and `mfaCode` is missing or wrong — a session cookie alone is no longer enough to stand up a durable API credential. `expiresInDays` now defaults to 90 days instead of never-expiring when omitted (the existing 3650-day cap is unchanged, so a genuinely long-lived token is still possible if requested explicitly). Changing a user's password, or enabling/disabling MFA, now revokes all of that user's live PAT tokens — mirrors the existing session auto-revoke-on-password-change behavior. `run-prod-app`/`run-dev-app` wire the new MFA↔PAT revoke callback automatically when both `auth-mfa` and `personal-access-tokens` are mounted; no app-level change needed for that part.

**Migration:** Apps that already mint PATs (their own client code, scripts, or tests) need to add `currentPassword` to the `create` request payload — this is a breaking change to the `create` request shape despite the minor bump (bundled-features doesn't follow strict semver across its handler schemas yet). If the caller has MFA enrolled, also include a valid `mfaCode`.

## 0.201.0

### framework-core

**IdempotencyGuard.check()/.store() gain a discriminated result + token param on top of the 0.198.0 signature (fw#2139).**

Fixes two idempotency-lock races that could let a duplicate request re-run a write handler or silently overwrite a fresher cached result. `waitTimeoutMs` (how long a duplicate request waits for the in-flight one) is now clamped to always exceed `pendingTtlSeconds` (the in-progress lock's own TTL) — previously the defaults (30s lock vs. 25s wait) let a retry give up and re-execute the handler while the original call was still legitimately running. `IdempotencyGuard.store()` now does an atomic compare-and-swap against the exact lock token the calling run acquired (Redis EVAL) instead of an unconditional SET, so a stale, slow-finishing run can no longer stomp the result a reclaiming run already persisted after the lock expired. `IdempotencyGuard.check()` now returns a discriminated `{ status: "cached", result }` / `{ status: "acquired", token }` union instead of `string | null`, and `store()` takes the acquired token as a new parameter.

**Migration:** Layered on top of the 0.198.0 signature change: check() is now check(tenantId, userId, requestId) returning { status: "cached", result } | { status: "acquired", token }; store() is now store(tenantId, userId, requestId, token). Both call sites in this repo (dispatch-batch.ts, the dispatcher test mock) are already updated; any code outside this repo calling IdempotencyGuard directly needs the same update.

**GET /files/:id now sniffs bytes and serves svg/txt/csv/json/md as application/octet-stream instead of inline (fw#2140).**

GET /files/:id served the stored mimeType as Content-Type without verifying it against the file's actual bytes — a client can declare any MIME at upload time, so an attacker could upload real HTML/SVG content and have it served back with a trusted-looking Content-Type from the app origin, enabling stored XSS. Uploads themselves are still accepted regardless of declared MIME (this is unchanged); the fix hardens serving instead. The download route now sniffs the file's magic bytes and only serves the sniffed Content-Type inline when it matches a known-safe binary signature (png/jpeg/gif/webp/pdf) AND matches the declared MIME from upload. Anything else — including a genuine mismatch, or file types with no reliable binary signature such as svg/txt/csv/json/md — is now served as application/octet-stream. This also adds X-Content-Type-Options: nosniff to GET /files/:id, which previously had none.

**Migration:** Breaking for consumers that render uploaded svg/txt/csv/json/md files inline (e.g. an <img src> pointing at GET /files/:id): those now download as application/octet-stream instead of rendering. Route such content through a purpose-built safe viewer if inline rendering is required.

## 0.198.0

### framework-core

**IdempotencyGuard.check/.store signature changed to (tenantId, userId, requestId); SqlExpression is branded (fw#2049).**

Security hardening (audit "Welle 2"): closes a request-supplied-JSON-can-forge-raw-SQL path and a cross-tenant idempotency-cache collision. `SqlExpression` is now branded — only the `sql` template tag and `sql.raw(...)` produce a value the query layer recognizes as raw SQL; an object literal built by hand (`{ kind: "sql-expr", sql: ..., params: ... }`) is no longer treated as raw SQL and gets bound as an ordinary JSON parameter instead, surfacing as a broken query rather than a silent vulnerability. `IdempotencyGuard.check`/`.store` moved from `(requestId)` to `(tenantId, userId, requestId)` so the idempotency cache can no longer be hit across tenants/users by an attacker who guesses or replays a requestId; the Redis key format changed from `${prefix}${requestId}` to `${prefix}${tenantId}:${userId}:${requestId}` with no compatibility shim.

**Migration:** Replace any hand-built SqlExpression object literal with the `sql` tag or `sql.raw(...)`. Any custom IdempotencyGuard implementation, or code calling `.check`/`.store` directly (outside the dispatcher's own runBatch, which already updated), needs the new (tenantId, userId, requestId) signature. On deploy, in-flight idempotent retries older than the request's own retry window may execute a second time — same as a first-ever request, not a correctness issue, just not a cache hit.

**event-store-executor.list() now throws 422 search_adapter_not_wired instead of returning unfiltered results (fw#2032).**

event-store-executor.list() silently dropped payload.search when no SearchAdapter was wired (neither at build time via options.searchAdapter nor at runtime via runtimeOptions.searchAdapter) — the list came back unfiltered, indistinguishable from a real search result. Now throws UnprocessableError (code: "unprocessable", details.reason: "search_adapter_not_wired", details.entity) instead.

**Migration:** Breaking for consumers whose entities are searchable but have no SearchAdapter wired: a search request that used to silently no-op now returns a 422. Wire a SearchAdapter (e.g. Meilisearch) for the entity, or stop marking the field/screen searchable.

**NavIconKey closed union replaces icon?: string on nav/config-mask definitions (fw#2055).**

NavDefinition.icon, ContentCollectionDefinition.nav.icon, ScreenNavSugar.icon and ConfigMask.icon were all icon?: string — any typo (icon: "seting") compiled fine and silently fell back to a dot in the sidebar. New NavIconKey union (@cosmicdrift/kumiko-types/nav-icon, re-exported from @cosmicdrift/kumiko-framework/{engine,ui-types}) types all four against the closed set of keys the web renderer actually registers, so an unregistered icon key is now a compile error at the r.nav()/r.screen({ nav })/config-mask call site instead of a missing icon at runtime. packages/renderer-web's NAV_ICONS map is checked against the same union via `as const satisfies Record<NavIconKey, …>`, so the type and the map can no longer drift.

**Migration:** Breaking for any app that passes an icon key outside the vocabulary in packages/types/src/nav-icon.ts — such a call site will fail to compile after this bump. Fix the typo or add the missing key to both NavIconKey and renderer-web's NAV_ICONS map in the same change.

## 0.195.0

### template-resolver

**ContentEditorProps gains a required id (fw#2001).**

TextBlockEditor's Field wrapping a registered "rich"/"plain" editor pointed its htmlFor at the fixed CONTENT_EDITOR_ELEMENT_ID, which only the never-mounted textarea fallback actually used — the label was disconnected from the real input as soon as a collection declared contentFormat: "rich" or "plain". TextBlockEditor now generates a per-instance id via useId() and passes it to both the Field and the ContentEditor, so the label stays correctly associated and two editors mounted on the same page no longer collide on a shared DOM id.

**Migration:** A custom-registered content editor component now needs to accept and use this id prop, rendering it onto its own focusable root element. Consumers that don't touch the DOM id directly are unaffected. CONTENT_EDITOR_ELEMENT_ID stays exported as a default value for callers that don't need their own generated id.

## 0.194.0

### file-derivatives

**PRESET_VARIANT_NAMES removed from public exports; publicVariantQuery accepts any name.**

The public GET /media/:fileRefId/:variant route now resolves the variant spec from the FileRef's field declaration (createImageField({ variants: {...} })) instead of a fixed spec table, so an app can declare and publicly serve its own variant names, and a field overriding a built-in preset name (thumb/card/hero/full) is served with its own spec instead of the frozen preset size. publicVariantQuery's schema now accepts any variant name (z.string().min(1).max(64)) instead of z.enum(PRESET_VARIANT_NAMES); resolution requires an exact match against the field's declared variants keys, and an unresolvable name answers 404, same as an unknown FileRef. The route's pre-DB path-param gate is now purely syntactic ([a-zA-Z0-9_-]{1,64}) instead of a name allow-list; a known-valid preset name plus a random fileRefId reached the same DB read as any other name, so the list only blocked the cheaper of two equally-costly attacks, and the actual defense is the existing per-IP rate limit and the UUID guard, both unchanged.

**Migration:** PRESET_VARIANT_NAMES only ever named the allow-list this release deletes, so there is nothing to migrate to. thumb/card/hero/full remain as ready-made specs to spread into a field's own variants.

## 0.193.0

### framework-core

**Image fields get named derived variants; ImageFieldDef/ImagesFieldDef.thumbnails removed (fw#1973).**

createImageField now accepts variants: Record<string, VariantSpec> — boot-validated named derived-image specs, served via GET /api/files/:id/variant/:name behind the same tenant + access guard as the download. A request carries only a NAME, never a spec, so no caller can drive an arbitrary render. The edit-form preview loads the first declared variant instead of the original.

**Migration:** ImageFieldDef.thumbnails / ImagesFieldDef.thumbnails are removed — the flag was never read by anything. Replace any reliance on it with a declared variants entry.

## 0.189.0

### framework-core

**createDateField now backs a real Postgres DATE column, round-trips as Temporal.PlainDate (fw#1924).**

type:"date" fields were silently aliased onto the same instant()/TIMESTAMPTZ column as type:"timestamp": reads returned a full ISO instant ("2026-03-15T00:00:00Z"), writes expected a bare "yyyy-mm-dd" string bound to a timestamptz column through the session's TimeZone — both directions were timezone-dependent for what is meant to be a pure calendar-day value. A date field now serializes as "2026-03-15" (Temporal.PlainDate's own toJSON()); a non-form client that Instant-parses a date field's JSON value now throws. Write shape is unchanged (bare "yyyy-mm-dd").

**Migration:** Managed (event-sourced projection) tables: the generator emits DROP TABLE + CREATE TABLE and replays from the event log automatically — factor in replay cost for entities with a large event history. Unmanaged (store_*, direct-write) tables: the generator emits an in-place ALTER TABLE … ALTER COLUMN … TYPE date USING (col AT TIME ZONE 'UTC')::date, anchored explicitly at UTC — do not hand-write a bare ALTER COLUMN … TYPE date without USING, which falls back to Postgres's session-TimeZone-dependent implicit cast.

## 0.177.0

### framework-core

**createMoneyField's amount now converts to/from minor-unit BIGINT storage (fw#1767).**

flattenMoney/rehydrateMoney used to pass the API amount straight into the BIGINT column without the minor-unit (cents) conversion the column's own doc comment always claimed. A decimal amount (e.g. 56799.16) crashed the insert (float into bigint); a plain integer major-unit amount (e.g. 45000 meaning €450.00) was silently stored as 45000 minor units — 100× too small on read-back.

**Migration:** amount is now always major units (ordinary decimal, e.g. 56799.16) on both write and read — DB storage stays exact-integer cents automatically, no caller change needed for that direction. If you already wrote createMoneyField data under the old (unconverted) semantics, multiply stored amounts by 100 before upgrading, or reconcile after — no known production deployment currently persists money-typed data (verified solon and phronexsis are both pre-launch before this merged).

## 0.167.1

### user

**user.locale no longer defaults to "de" (fw#1637).**

The entity-level default contradicted tenant-settings' own "en" default and silently overrode any app or tenant locale configuration for every new user. locale now stays unset until the client or a resolution chain provides one. Consumers that already fall back with `user.locale ?? "en"` are unaffected in shape but now see null instead of "de".

**Migration:** Run `kumiko-schema generate` and apply — the migration emits `ALTER TABLE read_users ALTER COLUMN locale DROP DEFAULT`. Note that DROP DEFAULT only affects future inserts: existing rows keep the "de" the old default wrote, which no user ever chose. Your app therefore splits into pre-bump users on "de" and post-bump users on null, and each group resolves to a different language. Decide deliberately: either keep the old values (and state that pre-bump users stay German), or run `UPDATE read_users SET locale = NULL WHERE locale = 'de'` once so every user follows the same chain — the latter only if no UI ever let users edit the field, otherwise it erases real choices. If your app relied on the implicit German default, set an explicit fallback instead (fw#1653).

## 0.167.0

### crypto-shredding

**Test-only reset helpers moved from /crypto to /testing (fw#1631).**

resetPiiSubjectKmsForTests and resetBlindIndexKeyForTests are no longer exported by the production barrels. The functions did not change — only the export path. Why it matters beyond tidiness: resetPiiSubjectKmsForTests clears the injected KMS, after which encryptForStorage sees no adapter and writes subject-annotated fields in plaintext, with no error and no log. Reachable from a production barrel, that is one stray import away from silent plaintext PII.

**Migration:** Change the import in your test files: `import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing"` instead of `.../crypto`. Type-check catches every occurrence; nothing else changes. Apps mounting crypto-shredding typically hit this in every test that configures an InMemoryKmsAdapter.

### framework-core

**resetEntityFieldEncryptionCacheForTests / resetEventPiiCatalogForTests moved to /testing (fw#1631).**

Test-only reset helpers with no owning feature: resetEntityFieldEncryptionCacheForTests left the /db barrel, resetEventPiiCatalogForTests left /crypto. The functions did not move, only their export path.

**Migration:** Import both from "@cosmicdrift/kumiko-framework/testing" instead of "/db" and "/crypto". Relative deep-imports of the defining module are unaffected.

**Six identity-sensitive error classes moved from kumiko-types into kumiko-framework (fw#1616).**

VersionConflictError, IdempotentAppendConflictError and ArchivedStreamError now live in /event-store, KeyErasedError, KeyNotFoundError and KeyAlreadyExistsError in /crypto — the public paths callers already import from. With no classes left in it, kumiko-types is a plain dependency again instead of a peerDependency, which closes the changesets cycle that escalated every minor release to a major.

**Migration:** Only affects direct imports from the removed @cosmicdrift/kumiko-types/event-store-errors subpath: import from @cosmicdrift/kumiko-framework/event-store or /crypto instead. Apps importing from the framework paths need no change.

## 0.166.0

### document-ingest-foundation

**documentExtract.pages: tenantOwned instead of encrypted, and the feature now requires tenant-lifecycle**

`pages` holds the full extracted text of ingested documents (invoices, IDs, contracts) and was `encrypted: true` — app-master-key ciphertext with no erasure subject, so no Art. 17 path could ever make it unreadable. It is now `tenantOwned: true`, which binds it to the tenant subject key that tenant-destroy's eraseSubjectKeys shreds. The feature registers an EXT_TENANT_DATA destroy hook for it, and since tenant-lifecycle hosts that extension point, `document-ingest-foundation` now declares it as a hard requirement — mounting the feature without tenant-lifecycle (plus its own tenant + compliance-profiles requires) makes createRegistry throw (#1621).

**Migration:** Mount createTenantFeature(), createComplianceProfilesFeature() and createTenantLifecycleFeature() alongside documentIngestFoundationFeature. Rows written before this version carry master-key envelope ciphertext that the subject-decrypt path does not recognise — readIngestPages returns [] for them. There is no reencrypt job; if you have existing extracts you care about, decrypt and rewrite them before upgrading.

## 0.165.1

### auth-email-password

**makeAuthGate / makeSessionAuthGate take a single LoginRouteOptions object (fw#1545).**

The four positional args (LoginComponent, loginProps, MfaVerifyComponent, MfaSetupComponent) did not scale past two optional MFA params. Shipped in the stranded 2.0.0 major and carried into the 0.165.1 line.

**Migration:** Rewrite call sites as makeAuthGate({ loginScreen, loginScreenProps, mfaVerifyScreen, mfaSetupScreen }). Type-check catches every occurrence.

## 0.165.0

### config

**Reencrypt job: removed legacy-decrypt path**

The old single-key format (CONFIG_ENCRYPTION_KEY) is no longer supported. The reencrypt job now classifies rows as rotate/current/unrecognized — unreadable rows are counted as failed instead of silently attempted.

**Migration:** If any config values still exist in the old single-key format, re-encrypt them with the current envelope format before upgrading. The job will now throw an error instead of attempting migration.

### user-data-rights

**Export download: removed ?token= query param**

GET /user-export/by-token no longer accepts the token as a query parameter. Only POST body (read from URL fragment) is supported now. Old email links with ?token= in the URL will stop working.

**Migration:** Replace any existing export links that use ?token= in the URL with POST-based links. The token is now only read from the URL fragment (#token), which browsers never send to the server.
