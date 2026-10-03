---
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Build info is baked into index.html as a meta tag instead of an inline script

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Prod builds no longer inject an inline script for the build info, so strict CSPs without unsafe-inline work without hashes or nonces
migration: |
  window.__KUMIKO_BUILD__ no longer exists. Code that read it (for example a version footer) now gets undefined and silently renders nothing. Replace the global with readLoadedBuild() from @cosmicdrift/kumiko-renderer-web, which returns { id, builtAt } from the new <meta name="kumiko-build"> tag, and drop the Window augmentation for __KUMIKO_BUILD__. The UpdateChecker needs no change.
-->
