---
"@cosmicdrift/kumiko-repo-manifest": minor
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-framework": patch
---

Add a `tooling` repo kind, scoped out of guards by default

`kumiko-repo-manifest`'s `repoKindSchema` gains a `"tooling"` value for a repo with no product code (infra, Pulumi, build tooling). `kumiko-guards`' `scanRoots` treats an omitted `ScanSpec.kinds` as "every root except tooling" instead of "every root" — only 7 of ~60 guards declare `kinds` today, so without this a tooling repo would have been silently pulled into every product-oriented guard; a guard now has to name `"tooling"` in `kinds` explicitly to scan one. Separately, `kumiko-framework`'s boot-validator now includes the implicit parent-id field in a form screen's `urlPrefillFields` when it's reached via a relatedList toolbarAction that declares no `params` of its own — the renderer already sends that field (`parentFilter.field`, else `parentParam`, else `"id"`), the boot-validator just wasn't allowlisting it.

<!-- kumiko-changes
feature: framework
type: improvement
title: Add a `tooling` repo kind, scoped out of guards by default
-->
