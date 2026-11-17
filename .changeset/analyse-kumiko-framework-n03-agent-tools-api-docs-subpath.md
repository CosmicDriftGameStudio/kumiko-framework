---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": patch
---

The API docs generator moves to `@cosmicdrift/kumiko-bundled-features/agent-tools/api-docs`.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: API docs generator on its own subpath
detail: `@cosmicdrift/kumiko-bundled-features/agent-tools` re-exported the API docs generator, so every runtime import of the tool catalog or agent manifest loaded the generator and its texts in five languages. `generateApiDocs`, `resolveApiDocsConfig`, `diffApiDocsOutput`, `ApiExampleFileSchema`, `WebhookExampleFileSchema`, `apiDocsLocales`, `isApiDocsLocale`, `formatApiDocsText`, `formatApiDocsProblem`, `INDEX_FILE`, `OPENAPI_FILE` and their types are now imported from `@cosmicdrift/kumiko-bundled-features/agent-tools/api-docs`. `createAgentToolsFeature` and `AGENT_TOOLS_FEATURE_NAME` stay on the barrel.
migration: Import `generateApiDocs`, `resolveApiDocsConfig`, `diffApiDocsOutput` and the other API docs symbols from `@cosmicdrift/kumiko-bundled-features/agent-tools/api-docs`.
affects: kumiko-bundled-features/agent-tools, generateApiDocs, resolveApiDocsConfig, diffApiDocsOutput
-->
