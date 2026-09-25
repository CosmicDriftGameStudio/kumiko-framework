---
"@cosmicdrift/kumiko-guards": patch
---

Tailwind-Scan-Surface Guard classifies files against the runner's roots

<!-- kumiko-changes
feature: guards
type: fix
title: Tailwind-Scan-Surface Guard classifies files against the runner's roots
detail: |
  The guard ignored the roots its runner passes to run() and re-derived the
  single repo of the current working directory. Under a multi-root runner,
  a file from a checkout outside cwd fell through to the packages/ marker
  fallback, which misreads a checkout path that itself contains a packages/
  segment. run() now uses the roots it is given, like the other guards.
-->
