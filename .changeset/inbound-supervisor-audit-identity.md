---
"@cosmicdrift/kumiko-bundled-features": patch
---

The inbound mail supervisor now passes the system identity as audit user to provider calls when the app's provider context has none. Before, every IMAP poll and watch failed in production because reading the stored mailbox credentials requires an audit identity.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: fix
title: Mail sync no longer fails when reading IMAP credentials
detail: createInboundMailSupervisor builds its provider context with auditUserId defaulting to the system user. Apps that did not set auditUserId in providerCtx got an internal error on every fetch and watch because the secrets context needs an audit identity. An explicitly set auditUserId is kept.
-->
