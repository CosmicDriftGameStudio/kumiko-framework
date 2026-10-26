---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

The inbound mail supervisor now reads provider credentials in the mail account's tenant scope. Before, under enforced row-level security in production, the worker saw no stored IMAP credentials and set every connected mailbox to auth error.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Mail sync finds the stored IMAP credentials under row-level security
detail: createInboundMailSupervisor runs outside any request, so secret reads ran without a tenant scope and the application role saw no row in read_tenant_secrets. The supervisor now wraps providerCtx.secrets with tenantScopedSecrets, which the framework exports from internal/row-level-security. inbound-provider-inmemory gains requireCredentialSecretOnFetch so tests can exercise credential reads; a new integration test runs the secrets against an application-role database.
-->
