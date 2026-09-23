---
"@cosmicdrift/kumiko-framework": minor
---

r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error

<!-- kumiko-changes
feature: framework
type: breaking
title: r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error
migration: |
  Registrations of known extension points (tenantData, userData, fileProvider, derivativeRenderer, derivativeOverlayResolver, derivativePublicPredicate, principalStatus, tenantLifecycleStatus, tokenVerifier, sessionStore, tenantResolver, tenantExistence) now type-check their options. Fix the reported mismatches: tenantData destroy hooks take TenantDataHookCtx (use ctx.db.* methods; for raw access such as archiveStream declare escapeHatch: { reason } on the registration and call ctx.db.unsafeRaw(reason)). userData registrations need at least one of export/delete (plus optional order). PrincipalStatusPlugin needs resolveProfile, FileProviderPlugin fakes need list(). App-owned points can opt in by augmenting KumikoExtensionOptionsMap via declare module "@cosmicdrift/kumiko-framework/engine"; unknown names keep the untyped options bag.
-->
