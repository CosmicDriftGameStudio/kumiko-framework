---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-types": patch
---

createTenantDb takes one options object, and HandlerContext/AppContext drop the internal _userId and _handlerType fields

<!-- kumiko-changes
feature: framework
type: breaking
title: createTenantDb({ db, tenantId, ... }) takes one options object
detail: |
  createTenantDb takes one CreateTenantDbOptions object ({ db, tenantId, mode?, tracer?, meter?, signal?, grants? }); mode still defaults to "tenant". The positional form createTenantDb(db, tenantId, mode, tracer, meter, signal, grants) keeps working as a deprecated overload and is removed in the first release after 2026-10-29.

  old -> new:
    createTenantDb(db, tenantId) -> createTenantDb({ db, tenantId })
    createTenantDb(db, tenantId, "system", tracer, meter, signal, grants) -> createTenantDb({ db, tenantId, mode: "system", tracer, meter, signal, grants })
migration: Run `bun kumiko-upgrade --apply`. It rewrites positional calls (literal undefined arguments are dropped) and reports spread arguments, calls with more than seven arguments and uses of createTenantDb as a value (callback, .bind/.call/.apply) with file and line.
codemod: scripts/codemod/tenant-db-options.ts
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: HandlerContext and AppContext no longer expose _userId and _handlerType
detail: |
  The dispatcher no longer sets _userId and _handlerType on the context of write handlers, query handlers and hooks. The caller identity is ctx.user.id. requireSecretsContext reads ctx._userId first and falls back to ctx.user.id, so passing a handler context to it keeps the same audit identity. Provider contexts (FileProviderContext, MailTransportContext, InboundMailContext) keep their own _userId. JobContext._userId is unchanged.
migration: Replace ctx._userId with ctx.user.id in write/query handlers and hooks. Known sites: one file each in money-horse, offlot-app, phronexsis and kumiko-enterprise. _handlerType had no readers.
-->
