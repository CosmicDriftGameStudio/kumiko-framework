---
"@cosmicdrift/kumiko-framework": patch
---

The Biome app preset no longer formats `bin/kumiko.ts` and `kumiko/schema.ts`, so apps that format with tabs stay green after `kumiko sync-managed`.

<!-- kumiko-changes
feature: framework
type: fix
title: Managed template files are exempt from Biome formatting
detail: `kumiko sync-managed` writes `bin/kumiko.ts` and `kumiko/schema.ts` with the template's two-space indentation and `kumiko check managed` compares them against the template, so an app formatting with tabs got Biome format findings it could not fix. The `@cosmicdrift/kumiko-framework/biome` preset now disables the formatter and import sorting for exactly these two files; lint rules still apply.
-->
