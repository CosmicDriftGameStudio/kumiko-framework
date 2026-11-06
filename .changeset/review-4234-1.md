---
"@cosmicdrift/kumiko-guards": minor
---

A new guard fails `biome-ignore lint/plugin` comments that silence the security Biome plugins.

<!-- kumiko-changes
feature: guards
type: breaking
title: security-plugin-suppression guard rejects biome-ignore on the security Biome plugins
detail: `biome-ignore lint/plugin` covers every plugin, so a reason of three words silenced the SSRF (`no-direct-fetch`), path-traversal (`no-direct-fs`), event-store write (`es-literal-writes`, `es-literal-writes-tests`, `restricted-event-store-symbols`) and `admin-api` checks. The new guard `security-plugin-suppression` re-runs Biome over every file with such a comment, in a temp copy with those comments neutralised and only the security plugins from the preset enabled. Each remaining diagnostic is a finding. UI plugins (raw-ui, raw-hooks, ...) and browser-side fetch in `web/**/*.tsx` stay suppressible. A Biome answer that cannot be parsed fails the guard. The guard needs `@biomejs/biome` and the `biome-rules` preset in the repo and does nothing without them.
migration: Replace each suppressed call with the safe API (`egress(policy)` instead of `fetch`, `FileStorageProvider` or `readBundledAsset` instead of `node:fs`, the event-store API instead of literal writes). A reviewed exception that cannot move is frozen once with `kumiko-guards guards --write-baseline --guard=security-plugin-suppression` into `.kumiko-security-plugin-suppression-baseline.json`; without that file the guard fails closed.
-->
