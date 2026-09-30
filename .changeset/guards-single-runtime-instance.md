---
"@cosmicdrift/kumiko-guards": minor
---

New repo check flags nested Kumiko package copies that drift from the top-level install

The new Single-Runtime-Instance check reads bun.lock and reports every Kumiko-scoped package resolved at more than one version unless it is marked dev/tooling/test; copies nested under a dev/tooling/test-marked package are ignored. The runtime-isolation guard also recognizes the "prod" kumiko.runtime marker.

<!-- kumiko-changes
feature: guards
type: improvement
title: New repo check flags nested Kumiko package copies that drift from the top-level install
migration: A repo whose bun.lock resolves a runtime/client/prod-marked Kumiko package at more than one version now fails `kumiko-guards checks`; align the dependency ranges or pin one version via root overrides. dev/tooling/test-marked packages (kumiko-cli, kumiko-guards, kumiko-repo-manifest) are exempt, as are copies nested under such a package (e.g. the kumiko-guards > kumiko-cli subtree).
-->
