---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Review fixes for document-ingest catch-up, documents constants, toggle sync, MFA and auth screens.

<!-- kumiko-changes
feature: framework
type: breaking
title: Review fixes in document-ingest, documents, feature-toggles, auth-mfa and auth-email-password
detail: appendMissingDocumentExtractEvent returns already-terminal when a concurrent catch-up run wins the append and treats any non-null meta.error as a failure. The documents feature builds hook targets, live entities and the link-list and delete-handler names from its entity constants. createRedisToggleSyncSignal takes the channel prefix and subscribe pattern as one RedisNamespace-shaped argument so they cannot diverge. A test ties TENANT_KEEP_ACCOUNT_ROLES to the account-close roles. Static invite accept returns an unexpected-response failure unless the server answered with an MFA gate. The MFA verify screen reuses MfaCodeOrRecoveryField, trims pasted recovery codes and the preauth setup screen focuses the code field once the recovery codes are acknowledged. Both forgot-password and signup screens share resolveReturnTo. Price env validation uses startsWith instead of an unescaped regex. AppendMissingExtractEventDeps drops the redundant tenantId and relies on tenantDb.tenantId. The framework exports MAX_RETURN_PATH_LENGTH from utils as the single source for the returnTo limit, used by the auth routes and re-exported by the auth-email-password return-path module. Deleting a since-undeclared secret key under a mounted feature prefix works for SystemAdmin and stays unknown-key for tenant admins.
migration: Callers of `createRedisToggleSyncSignal` that passed the channel prefix and subscribe pattern as third and fourth argument pass `{ channelPrefix, channelSubscribePattern }` as third argument instead. Callers of `appendMissingDocumentExtractEvent` stop passing `tenantId` in the deps.
-->
