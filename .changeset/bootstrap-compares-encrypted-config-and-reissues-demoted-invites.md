---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-framework": patch
---

Bootstrap idempotency for encrypted config and demoted invitations

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Bootstrap reruns no longer rewrite encrypted config or restore dropped global roles
detail: Declarative bootstrap compares encrypted and piiEncrypted config keys by their decrypted value, so a matching rerun writes nothing, and re-issues an invitation whose stored global roles are no longer in the plan. makeDispatchWriteAs is exported from the framework api.
-->
