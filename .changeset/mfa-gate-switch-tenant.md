---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

`POST /auth/switch-tenant` now runs the same MFA gate as login before it issues the new session. A user who is a plain member in one tenant and an admin in another can no longer reach an admin session without a second factor by switching. When the target tenant requires MFA the route answers with the login contract (`mfaRequired` plus `challengeToken`, or `mfaSetupRequired` plus `preauthSetupToken`) and sets no cookies. The gate runs in a new system-only handler, `auth-email-password:write:switch-tenant-mfa-gate`, which resolves the membership and roles itself; `runDevApp` and `runProdApp` wire it as `switchTenantMfaGateHandler` whenever auth-mfa is mounted.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: switch-tenant enforces the MFA gate before issuing a session
-->
