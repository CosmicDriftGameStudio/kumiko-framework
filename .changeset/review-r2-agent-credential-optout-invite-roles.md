---
"@cosmicdrift/kumiko-bundled-features": patch
---

The credential-carrying handlers `auth-email-password:login`, `change-password`, `user-profile:change-email`, `auth-mfa:verify` and `auth-mfa:enable-confirm-preauth` are now opted out of the agent tool catalog with `agent: { expose: false }`, so passwords, TOTP codes and setup tokens no longer reach an LLM transcript. `invite.additionalAssignableRoles` now throws at construction when it lists a framework-ranked role such as `TenantAdmin`, instead of silently disabling the elevation guard for it.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Credential-carrying auth handlers are hidden from the agent catalog; additionalAssignableRoles rejects framework-ranked roles
-->
