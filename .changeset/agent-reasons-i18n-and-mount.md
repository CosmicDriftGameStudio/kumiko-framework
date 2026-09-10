---
"@cosmicdrift/kumiko-framework": patch
"create-kumiko-app": patch
---

The four `agent.*` reason codes now have en/de i18n texts, so the docs generator
stops skipping them and renders a reference page per reason instead of leaving
the agent error pages absent. `feature-manifest.json` additionally lists
`agent-tools`, which the use-all-bundled sample now mounts — the manifest is
introspected from that sample, so the bundled-feature reference had no entry for
it before.
