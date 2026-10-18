---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

The deprecated compatibility paths from 0.366 to 0.368 are removed

<!-- kumiko-changes
feature: framework
type: breaking
title: createDbConnection takes only the options object, the bun-db subpath is gone
detail: The positional createDbConnection(url, options) overload and the deprecated @cosmicdrift/kumiko-framework/bun-db subpath are removed. createDbConnection({ url, ...options }) and the query helpers come from @cosmicdrift/kumiko-framework/db. Removed from /bun-db: DeleteManyBatchedOptions, DeleteManyBatchedResult, IncrementCounterOptions, InnerJoinRow, InnerJoinSpec, InsertOnConflictDoNothingOptions, JoinColumnPair, JsonTextMatch, SelectOptions, TableInfo, UpsertOnConflictOptions, WhereObject, WhereOperator, WhereValue, aggregateWhere, asEntityTableMeta, asRawClient, countWhere, deleteMany, deleteManyBatched, extractTableInfo, fetchOne, incrementCounter, insertMany, insertOnConflictDoNothing, insertOne, instantToTimestamptzParam, isTimestamptzType, requireEntityTableMeta, runInSavepoint, runInSavepointIfSupported, runnerCanBeginTransaction, selectInnerJoin, selectMany, transaction, unsafeReadRetrying, updateMany, upsertByPk, upsertOnConflict.
migration: Run bun kumiko-upgrade --apply. It rewrites positional calls to createDbConnection({ url, ... }) and moves bun-db imports to @cosmicdrift/kumiko-framework/db.
codemod: scripts/codemod/db-factory.ts
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: DB_PROVIDER other than postgres fails at boot
detail: dbConnectionOptionsFromEnv used to ignore DB_PROVIDER, so DB_PROVIDER=bun booted postgres-js while the deployment still claimed Bun.SQL. Any value other than empty or "postgres" now throws with a hint to remove the variable.
migration: Remove DB_PROVIDER from the environment, Helm values and Pulumi config. postgres-js is the only driver.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: createTenantDb takes only the options object
detail: The positional createTenantDb(db, tenantId, ...) overload is removed. createTenantDb({ db, tenantId, ... }) is the only form.
migration: Run bun kumiko-upgrade --apply. It rewrites positional calls to createTenantDb({ db, tenantId, ... }).
codemod: scripts/codemod/tenant-db-options.ts
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: The test stack is no longer re-exported from the framework
detail: The subpaths @cosmicdrift/kumiko-framework/stack, /testing, /testing/handler-context, /testing/real-providers and /testing/e2e-generator are removed, and so is the optional peer dependency on @cosmicdrift/kumiko-testing. The test stack and helpers live only in @cosmicdrift/kumiko-testing. Removed from /stack: CreateTestDbOptions, EventCollector, RequestHelper, TestDb, TestRedis, TestStack, TestStackOptions, TestUsers, createEventCollector, createRequestHelper, createTestDb, createTestRedis, createTestUser, drainEventConsumers, pushEntityProjectionTables, resetEventStore, setupTestStack, testTenantId, testUserId, unsafeCreateEntityTable, unsafeEnsureEntityTable, unsafePushTables. Removed from /testing and its subpaths: ClearableTable, E2EGeneratorOptions, E2ETestSpec, EditFillOp, LateBoundHolder, ManualClock, MutableMasterKeyProvider, ParsedSetCookie, REAL_PROVIDERS_ENV, RecordingProvider, bridgeStub, buildMultipartBody, captureClosedConnectionError, clearTables, createLateBoundHolder, createManualClock, createMutableMasterKeyProvider, createRecordingProvider, createTestEnvelopeCipher, createTestMasterKeyProvider, deleteRows, describeFileProviderContract, expectError, expectErrorIncludes, expectSuccess, generateE2ESpec, generateZodFixture, getSetCookieRaw, getSetCookieValue, getSetCookies, isRealProviderRun, patchFileInstanceofForBunTest, requireRealProviders, resetBlindIndexKeyForTests, resetEntityFieldEncryptionCacheForTests, resetEventPiiCatalogForTests, resetPiiSubjectKmsForTests, resetTestTables, rolesOf, seedRow, seedRows, sharedItemEntity, sharedItemTable, sharedUserEntity, sharedUserTable, sharedWidgetEntity, sharedWidgetTable, sleep, updateRows, waitFor, withBootValidatorFixture, withoutAmbientTemporal, zipWithEntries.
migration: Run bun kumiko-upgrade --apply. It moves the imports to the matching @cosmicdrift/kumiko-testing subpaths. Add @cosmicdrift/kumiko-testing to devDependencies if it is not there yet.
codemod: scripts/codemod/testing-move.ts
-->

<!-- kumiko-changes
feature: file-provider-s3
type: breaking
title: The file-provider-s3-env and files-provider-s3 subpaths are removed
detail: Both deprecated re-export subpaths of the S3 merge are gone. The env-driven provider is createFileProviderS3Feature({ fromEnv: true }) from @cosmicdrift/kumiko-bundled-features/file-provider-s3 and replaces fileProviderS3EnvFeature. S3ProviderConfig, createS3Provider, createS3ProviderFromEnv, parseS3EnvConfig and resolveForcePathStyle come from @cosmicdrift/kumiko-bundled-features/file-provider-s3/lib.
migration: Run bun kumiko-upgrade --apply. It rewrites fileProviderS3EnvFeature to createFileProviderS3Feature({ fromEnv: true }) and moves files-provider-s3 imports to file-provider-s3/lib.
codemod: scripts/codemod/s3-imports.ts
-->

<!-- kumiko-changes
feature: compliance-profiles-ops
type: breaking
title: The deprecated complianceProfilesOpsFeature constant is removed
detail: complianceProfilesOpsFeature was kept next to createComplianceProfilesOpsFeature() for one release. Mount the feature by calling createComplianceProfilesOpsFeature().
migration: Run bun kumiko-upgrade --apply. It replaces complianceProfilesOpsFeature with createComplianceProfilesOpsFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: readiness
type: breaking
title: The deprecated readinessFeature constant is removed
detail: readinessFeature was kept next to createReadinessFeature() for one release. Mount the feature by calling createReadinessFeature().
migration: Run bun kumiko-upgrade --apply. It replaces readinessFeature with createReadinessFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: tier-engine
type: breaking
title: The deprecated tierEngineFeature constant is removed
detail: tierEngineFeature was kept next to createTierEngineFeature() for one release. Mount the feature by calling createTierEngineFeature().
migration: Run bun kumiko-upgrade --apply. It replaces tierEngineFeature with createTierEngineFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: cap-counter
type: breaking
title: The deprecated capCounterFeature constant is removed
detail: capCounterFeature was kept next to createCapCounterFeature() for one release. Mount the feature by calling createCapCounterFeature().
migration: Run bun kumiko-upgrade --apply. It replaces capCounterFeature with createCapCounterFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: custom-fields
type: breaking
title: The deprecated customFieldsFeature constant is removed
detail: customFieldsFeature was kept next to createCustomFieldsFeature() for one release. Mount the feature by calling createCustomFieldsFeature().
migration: Run bun kumiko-upgrade --apply. It replaces customFieldsFeature with createCustomFieldsFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: tags
type: breaking
title: The deprecated tagsFeature constant is removed
detail: tagsFeature was kept next to createTagsFeature() for one release. Mount the feature by calling createTagsFeature().
migration: Run bun kumiko-upgrade --apply. It replaces tagsFeature with createTagsFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: tenant-settings
type: breaking
title: The deprecated tenantSettingsFeature constant is removed
detail: tenantSettingsFeature was kept next to createTenantSettingsFeature() for one release. Mount the feature by calling createTenantSettingsFeature().
migration: Run bun kumiko-upgrade --apply. It replaces tenantSettingsFeature with createTenantSettingsFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: folders
type: breaking
title: The deprecated foldersFeature constant is removed
detail: foldersFeature was kept next to createFoldersFeature() for one release. Mount the feature by calling createFoldersFeature().
migration: Run bun kumiko-upgrade --apply. It replaces foldersFeature with createFoldersFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: notes-history
type: breaking
title: The deprecated notesHistoryFeature constant is removed
detail: notesHistoryFeature was kept next to createNotesHistoryFeature() for one release. Mount the feature by calling createNotesHistoryFeature().
migration: Run bun kumiko-upgrade --apply. It replaces notesHistoryFeature with createNotesHistoryFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: notes-history-user-data
type: breaking
title: The deprecated notesHistoryUserDataFeature constant is removed
detail: notesHistoryUserDataFeature was kept next to createNotesHistoryUserDataFeature() for one release. Mount the feature by calling createNotesHistoryUserDataFeature().
migration: Run bun kumiko-upgrade --apply. It replaces notesHistoryUserDataFeature with createNotesHistoryUserDataFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: form-draft
type: breaking
title: The deprecated formDraftFeature constant is removed
detail: formDraftFeature was kept next to createFormDraftFeature() for one release. Mount the feature by calling createFormDraftFeature().
migration: Run bun kumiko-upgrade --apply. It replaces formDraftFeature with createFormDraftFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: form-draft-user-data
type: breaking
title: The deprecated formDraftUserDataFeature constant is removed
detail: formDraftUserDataFeature was kept next to createFormDraftUserDataFeature() for one release. Mount the feature by calling createFormDraftUserDataFeature().
migration: Run bun kumiko-upgrade --apply. It replaces formDraftUserDataFeature with createFormDraftUserDataFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: template-resolver-user-data
type: breaking
title: The deprecated templateResolverUserDataFeature constant is removed
detail: templateResolverUserDataFeature was kept next to createTemplateResolverUserDataFeature() for one release. Mount the feature by calling createTemplateResolverUserDataFeature().
migration: Run bun kumiko-upgrade --apply. It replaces templateResolverUserDataFeature with createTemplateResolverUserDataFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: folders-user-data
type: breaking
title: The deprecated foldersUserDataFeature constant is removed
detail: foldersUserDataFeature was kept next to createFoldersUserDataFeature() for one release. Mount the feature by calling createFoldersUserDataFeature().
migration: Run bun kumiko-upgrade --apply. It replaces foldersUserDataFeature with createFoldersUserDataFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: ledger
type: breaking
title: The deprecated ledgerFeature constant is removed
detail: ledgerFeature was kept next to createLedgerFeature() for one release. Mount the feature by calling createLedgerFeature().
migration: Run bun kumiko-upgrade --apply. It replaces ledgerFeature with createLedgerFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: billing-foundation
type: breaking
title: The deprecated billingFoundationFeature constant is removed
detail: billingFoundationFeature was kept next to createBillingFoundationFeature() for one release. Mount the feature by calling createBillingFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces billingFoundationFeature with createBillingFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: auth-foundation
type: breaking
title: The deprecated authFoundationFeature constant is removed
detail: authFoundationFeature was kept next to createAuthFoundationFeature() for one release. Mount the feature by calling createAuthFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces authFoundationFeature with createAuthFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: mail-foundation
type: breaking
title: The deprecated mailFoundationFeature constant is removed
detail: mailFoundationFeature was kept next to createMailFoundationFeature() for one release. Mount the feature by calling createMailFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces mailFoundationFeature with createMailFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: The deprecated inboundMailFoundationFeature constant is removed
detail: inboundMailFoundationFeature was kept next to createInboundMailFoundationFeature() for one release. Mount the feature by calling createInboundMailFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces inboundMailFoundationFeature with createInboundMailFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: inbound-provider-inmemory
type: breaking
title: The deprecated inboundProviderInMemoryFeature constant is removed
detail: inboundProviderInMemoryFeature was kept next to createInboundProviderInMemoryFeature() for one release. Mount the feature by calling createInboundProviderInMemoryFeature().
migration: Run bun kumiko-upgrade --apply. It replaces inboundProviderInMemoryFeature with createInboundProviderInMemoryFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: inbound-provider-imap
type: breaking
title: The deprecated inboundProviderImapFeature constant is removed
detail: inboundProviderImapFeature was kept next to createInboundProviderImapFeature() for one release. Mount the feature by calling createInboundProviderImapFeature().
migration: Run bun kumiko-upgrade --apply. It replaces inboundProviderImapFeature with createInboundProviderImapFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: mail-transport-smtp
type: breaking
title: The deprecated mailTransportSmtpFeature constant is removed
detail: mailTransportSmtpFeature was kept next to createMailTransportSmtpFeature() for one release. Mount the feature by calling createMailTransportSmtpFeature().
migration: Run bun kumiko-upgrade --apply. It replaces mailTransportSmtpFeature with createMailTransportSmtpFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: mail-transport-inmemory
type: breaking
title: The deprecated mailTransportInMemoryFeature constant is removed
detail: mailTransportInMemoryFeature was kept next to createMailTransportInMemoryFeature() for one release. Mount the feature by calling createMailTransportInMemoryFeature().
migration: Run bun kumiko-upgrade --apply. It replaces mailTransportInMemoryFeature with createMailTransportInMemoryFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: file-foundation
type: breaking
title: The deprecated fileFoundationFeature constant is removed
detail: fileFoundationFeature was kept next to createFileFoundationFeature() for one release. Mount the feature by calling createFileFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces fileFoundationFeature with createFileFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: document-ingest-foundation
type: breaking
title: The deprecated documentIngestFoundationFeature constant is removed
detail: documentIngestFoundationFeature was kept next to createDocumentIngestFoundationFeature() for one release. Mount the feature by calling createDocumentIngestFoundationFeature().
migration: Run bun kumiko-upgrade --apply. It replaces documentIngestFoundationFeature with createDocumentIngestFoundationFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: file-provider-inmemory
type: breaking
title: The deprecated fileProviderInMemoryFeature constant is removed
detail: fileProviderInMemoryFeature was kept next to createFileProviderInMemoryFeature() for one release. Mount the feature by calling createFileProviderInMemoryFeature().
migration: Run bun kumiko-upgrade --apply. It replaces fileProviderInMemoryFeature with createFileProviderInMemoryFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: file-derivatives
type: breaking
title: The deprecated fileDerivativesFeature constant is removed
detail: fileDerivativesFeature was kept next to createFileDerivativesFeature() for one release. Mount the feature by calling createFileDerivativesFeature().
migration: Run bun kumiko-upgrade --apply. It replaces fileDerivativesFeature with createFileDerivativesFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: derivatives-sharp
type: breaking
title: The deprecated derivativesSharpFeature constant is removed
detail: derivativesSharpFeature was kept next to createDerivativesSharpFeature() for one release. Mount the feature by calling createDerivativesSharpFeature().
migration: Run bun kumiko-upgrade --apply. It replaces derivativesSharpFeature with createDerivativesSharpFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: auth-mfa-user-data
type: breaking
title: The deprecated authMfaUserDataFeature constant is removed
detail: authMfaUserDataFeature was kept next to createAuthMfaUserDataFeature() for one release. Mount the feature by calling createAuthMfaUserDataFeature().
migration: Run bun kumiko-upgrade --apply. It replaces authMfaUserDataFeature with createAuthMfaUserDataFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: workflow-runner
type: breaking
title: The deprecated workflowRunnerFeature constant is removed
detail: workflowRunnerFeature was kept next to createWorkflowRunnerFeature() for one release. Mount the feature by calling createWorkflowRunnerFeature().
migration: Run bun kumiko-upgrade --apply. It replaces workflowRunnerFeature with createWorkflowRunnerFeature().
codemod: scripts/codemod/feature-factory.ts
-->

<!-- kumiko-changes
feature: file-provider-s3
type: breaking
title: The deprecated fileProviderS3Feature constant is removed
detail: fileProviderS3Feature was kept next to createFileProviderS3Feature() for one release. Mount the feature by calling createFileProviderS3Feature().
migration: Run bun kumiko-upgrade --apply. It replaces fileProviderS3Feature with createFileProviderS3Feature().
codemod: scripts/codemod/feature-factory.ts
-->
