---
"@cosmicdrift/kumiko-guards": patch
---

The license check ships exceptions for the framework's transitive dependencies and self-hosted fonts.

<!-- kumiko-changes
feature: guards
type: improvement
title: Bundled license exceptions cover framework transitives
detail: `caniuse-lite`, `slick`, `@img/sharp-libvips-*`, `@fontsource/*` and `@fontsource-variable/*` are now in the exceptions bundled with `@cosmicdrift/kumiko-guards`, so apps no longer need their own copies. Entries an app keeps are merged and do no harm.
migration: Optionally remove these entries from the app's `dependency-license-exceptions.json`.
-->
