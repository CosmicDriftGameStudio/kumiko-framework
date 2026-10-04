---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-server-runtime": minor
---

`docsUrl` in error responses is now resolved at serialization by `resolveErrorDocsUrl`. Framework reasons (and errors without a reason) link to the framework docs as before. An app's own reasons no longer link to the framework docs, where no page exists for them: they get a `docsUrl` only if the new option `errorDocs: { baseUrl, reasons: string[] | "all" }` (on `runProdApp`, `buildServer`, `createKumikoServer`, `setupTestStack`) covers them.

Migration: `KumikoError.docsUrl` (the getter) is removed; use `resolveErrorDocsUrl(err, errorDocs?)`. `ErrorResponseBody.docsUrl` is now optional. Apps whose clients read `docsUrl` for app reasons pass `errorDocs` or handle the missing field.

<!-- kumiko-changes
feature: framework
type: breaking
title: App error reasons only carry a docsUrl when errorDocs covers them
migration: |
  KumikoError.docsUrl (the getter) is removed; call resolveErrorDocsUrl(err, errorDocs?) instead. ErrorResponseBody.docsUrl is optional. Apps whose clients read docsUrl for app reasons pass errorDocs or handle the missing field.
-->
