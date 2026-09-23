---
"@cosmicdrift/kumiko-framework": minor
---

r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error

<!-- kumiko-changes
feature: framework
type: breaking
title: r.useExtension options are typed per extension point; a hook with the wrong ctx signature is a compile error
migration: |
  Registrations of known extension points (tenantData, userData, fileProvider, derivativeRenderer, derivativeOverlayResolver, derivativePublicPredicate, principalStatus, tenantLifecycleStatus, tokenVerifier, sessionStore, tenantResolver, tenantExistence) now type-check their options, and options are required for them. Fix the reported mismatches: tenantData destroy hooks take TenantDataHookCtx and use ctx.db.* methods. For raw access such as archiveStream, declare escapeHatch: { reason } on the r.useExtension registration (runtime grant), call declareEscapeHatch({ reason }) as a direct statement in the hook body (Escape-Hatch-Declared guard), then use ctx.db.unsafeRaw(reason). userData registrations need at least one of export/delete (plus optional order). PrincipalStatusPlugin needs resolveProfile, FileProviderPlugin fakes need list(). App-owned points can opt in by augmenting KumikoExtensionOptionsMap via declare module "@cosmicdrift/kumiko-framework/engine"; unknown names keep the untyped options bag.
-->
