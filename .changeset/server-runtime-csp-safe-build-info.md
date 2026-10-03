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
  No code change needed. The build id now lives in <meta name="kumiko-build"> and the UpdateChecker reads it from there. Code that read window.__KUMIKO_BUILD__ directly must read the meta tag (content = id, data-built-at = timestamp) instead.
-->
