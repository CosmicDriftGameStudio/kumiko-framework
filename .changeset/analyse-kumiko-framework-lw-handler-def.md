---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

Bundled handlers are built with `defineWriteHandler`/`defineQueryHandler`, so their payloads are typed from the schema and the engine-payload casts are gone; a codemod moves app handlers the same way.

<!-- kumiko-changes
feature: feature-ast
type: breaking
title: Handlers are defined with defineWriteHandler/defineQueryHandler
detail: The bundled features no longer annotate handlers with the erased `WriteHandlerDef`/`QueryHandlerDef`. Factories such as `createEnsureAccountsHandler`, `createSubjectTotalsHandler`, `createScheduleActualsHandler`, `createBalancesReportHandler`, `createIncomeStatementHandler` and `createBalanceSheetHandler` return the typed `WriteHandlerDefinition`/`QueryHandlerDefinition`, which is not assignable to `WriteHandlerDef`. `withCapEnforcement` keeps the wrapped handler's type and still accepts a `WriteHandlerDef`. Two guards cover what is left: the As-Casts Audit (`check-as-casts`) counts a cast with `@cast-boundary engine-payload` on `event.payload`/`query.payload` inside `handlers/*.write.ts`/`*.query.ts` as suspect; it does not see casts outside `handlers/`, other parameter names, destructured payloads, other marker reasons or `schema.parse(event.payload)` re-parses. The Handler Definitions ratchet (`guard-handler-definitions`) counts every literal annotated, `satisfies`- or `as`-typed with `WriteHandlerDef`/`QueryHandlerDef` and every function returning such a literal, anywhere in the scanned tree, against `.kumiko-handler-definitions-baseline.json`; it does not see a returned identifier, aliases of the erased types or test files.
migration: Run the codemod. It wraps literals annotated with `WriteHandlerDef`/`QueryHandlerDef` (variables and factory returns) in `defineWriteHandler`/`defineQueryHandler`, drops the annotation, removes `event.payload as z.infer<typeof schema>` casts and `schema.parse(event.payload)` re-parses on the handler's own schema and fixes the imports. It checks every use across the project and converts a handler only when all uses are `r.writeHandler`/`r.queryHandler` arguments, re-exports, property reads or `withCapEnforcement`/`withStockCap`. Listed as manual: handlers spreading another handler, dynamic schemas, `satisfies`/`as` forms and handlers used anywhere else, for example passed to an app wrapper typed `WriteHandlerDef`, put into an array or stored in an annotated variable. Give such a wrapper the two overloads of `withCapEnforcement` (erased and typed) or keep the handler erased and freeze it with `kumiko-guards guards --write-baseline --guard="Handler Definitions"`. Code that stored a bundled factory result in a `WriteHandlerDef`/`QueryHandlerDef` variable drops that annotation.
affects: WriteHandlerDef, QueryHandlerDef, withCapEnforcement, createEnsureAccountsHandler, createSubjectTotalsHandler, createScheduleActualsHandler, createBalancesReportHandler, createIncomeStatementHandler, createBalanceSheetHandler
codemod: scripts/codemod/define-handler.ts
manualAfterCodemod: true
-->
