---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

createAuthRoutes requires the switch-tenant MFA gate when MFA verify is wired

<!-- kumiko-changes
feature: framework
type: fix
title: MFA verify without a switch-tenant gate fails at boot, and the gate result carries the session roles
detail: createAuthRoutes throws when mfaVerifyHandler is set without switchTenantMfaGateHandler, and runDevApp and runProdApp check that the gate handler is registered before wiring, so a missing gate can no longer let switch-tenant skip MFA. The gate handler returns the roles with its clear result and the route mints the target session from them. assertRetiredCookieDomains is no longer exported, and the auth-session signup variant is composed from SignupOutcome. Setups that set mfaVerifyHandler must also register the switch-tenant gate handler.
-->
