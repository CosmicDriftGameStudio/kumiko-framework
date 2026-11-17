---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

Handler contracts type dispatch: `queryContract` and `writeContract` declare a handler's payload and result once, and dispatch on server and client infers both from it.

<!-- kumiko-changes
feature: framework-core
type: feature
title: Typed dispatch through handler contracts
detail: `@cosmicdrift/kumiko-types/handler-contract` is client-safe and exports `queryContract<TPayload, TResult>(qualifiedName)` and `writeContract<TPayload, TData>(qualifiedName)`. `ctx.dispatch.query`, `queryAs`, `write` and `writeAs`, the job dispatch, the server `Dispatcher`, the extra-route and httpRoute deps (`query`, `write`, `systemQuery`) and the renderer hooks `useQuery` and `useMutation` accept a contract in place of the qualified name, check the payload against it and return the declared result type without a cast. The string form stays for qualified names built at runtime. Auth routes map handler error statuses through one helper instead of casting them.
migration: None required. Replace `result as X` and `useQuery<X>(qn, payload)` with a contract exported next to the feature's constants.
-->
