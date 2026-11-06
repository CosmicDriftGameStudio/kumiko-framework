---
"@cosmicdrift/kumiko-cli": minor
---

`kumiko check` refuses a lint step whose biome config does not extend the Kumiko preset.

<!-- kumiko-changes
feature: cli
type: breaking
title: kumiko check fails when biome.json does not extend the Kumiko Biome preset
detail: The lint step now reads `biome.json` or `biome.jsonc` (comments allowed) before it starts Biome and follows relative `extends` entries. It passes only if the chain reaches `@cosmicdrift/kumiko-framework/biome-rules`, `@cosmicdrift/kumiko-framework/biome` or a relative path to the framework's `presets/biome-rules.json` or `presets/biome-app.json`. Without the preset the SSRF, path-traversal, event-store write and admin-API plugins are missing and the step used to stay green; now it exits 1 and does not start Biome.
migration: Add `"extends": ["@cosmicdrift/kumiko-framework/biome"]` to the repo's `biome.json` (`@cosmicdrift/kumiko-framework/biome-rules` for repos that keep their own file layout).
-->
