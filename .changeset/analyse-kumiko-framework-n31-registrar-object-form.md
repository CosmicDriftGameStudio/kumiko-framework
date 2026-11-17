---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-feature-ast": minor
---

Every registrar verb takes one options object, and `r.useExtension` is now `r.applyExtension`.

<!-- kumiko-changes
feature: framework-core
type: breaking
title: Registrar verbs take one options object; r.useExtension becomes r.applyExtension
detail: The positional overloads of `r.optionalRequires`, `r.relation`, `r.config`, `r.job`, `r.notification`, `r.readsConfig`, `r.referenceData`, `r.useExtension`, `r.metric`, `r.secret`, `r.secretNamespace`, `r.claimKey` and `r.streamHandler` are removed; each keeps the object form it already had. `r.useExtension` is renamed to `r.applyExtension`, so React lint rules no longer treat it as a hook. The runtime checks that rejected positional calls to `r.entity`, `r.writeHandler`, `r.queryHandler`, `r.hook`, `r.requires` and `r.defineWebhookEvent` are removed together with the boot rules `registrar/options-object-required` and `registrar/argument-missing`; the types reject those calls. The boot rule `extension/use-escape-hatch-invalid` is now `extension/apply-escape-hatch-invalid`.
migration: Run the codemod. It rewrites positional calls into the object form, renames `r.useExtension` to `r.applyExtension` and removes the `biome-ignore lint/correctness/useHookAtTopLevel` comment above it. `r.config("key", def)` becomes `r.config({ keys: { key: def } }).key`. Rewrite the sites it lists as manual by hand, and rename `r.useExtension(` in strings and Markdown by hand.
codemod: scripts/codemod/registrar-single-form.ts
manualAfterCodemod: true
-->
