---
"@cosmicdrift/kumiko-framework": minor
---

The five re-export shim packages `@cosmicdrift/kumiko-headless`, `@cosmicdrift/kumiko-dispatcher-live`, `@cosmicdrift/kumiko-renderer-web`, `@cosmicdrift/kumiko-http` and `@cosmicdrift/kumiko-repo-manifest` are no longer built or published.

<!-- kumiko-changes
feature: framework
type: breaking
title: Re-export shim packages removed
detail: The shims headless, dispatcher-live, renderer-web, http and repo-manifest are gone. Their code lives in kumiko-renderer (/headless, /live, /web), kumiko-framework (/http) and kumiko-guards (/repo-manifest).
migration: Run bun kumiko-upgrade --apply, or bun kumiko codemod package-merge . --write. It rewrites the imports and package.json dependencies of all five shims to their target packages.
codemod: scripts/codemod/package-merge.ts
-->
