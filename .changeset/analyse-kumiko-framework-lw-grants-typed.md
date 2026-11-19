---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

A handler built with defineWriteHandler, defineQueryHandler or definePagedQueryHandler whose escapeHatch grants crossTenantReads gets ctx.crossTenantReads typed as present, and the dispatch checks the field before the handler runs.

<!-- kumiko-changes
feature: framework-core
type: improvement
title: A crossTenantReads grant types ctx.crossTenantReads as present
detail: When `escapeHatch.grants` lists `"crossTenantReads"` as a literal, the handler's `ctx.crossTenantReads` is `CrossTenantReads` instead of `CrossTenantReads | undefined`, also combined with `systemScope: true`, so the `if (!ctx.crossTenantReads)` guard is no longer needed. The wrapper checks the field on every dispatch and names the handler: an agent tool call or a resolved member principal gets `access_denied`, a context without a db gets `internal_error`. Previously the handler ran and found the field missing. An `unsafeRaw` grant still provides `ctx.crossTenantReads` at runtime but keeps it optional in the type. The field stays optional where the compiler cannot see the literal list: a shared `EscapeHatchDeclaration` constant, explicit type arguments, or inline `r.queryHandler`/`r.writeHandler` objects and jobs. `EscapeHatchDeclaration` takes an optional grant type parameter, and `WriteHandlerInput` and `QueryHandlerInput` take an optional last `TGrant` parameter. New export `GrantedHandlerContext` and the type guard `hasCrossTenantReads` from `@cosmicdrift/kumiko-types/handlers`.
-->
