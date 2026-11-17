---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": patch
---

The API docs generator moves to `@cosmicdrift/kumiko-bundled-features/agent-tools/api-docs`; `createAgentToolsFeature` is removed.

<!-- kumiko-changes
feature: agent-tools
type: breaking
title: API docs generator on its own subpath, agent-tools feature removed
detail: `@cosmicdrift/kumiko-bundled-features/agent-tools` re-exported the API docs generator, so every runtime import of the tool catalog or agent manifest loaded the generator and its texts in five languages. `generateApiDocs`, `resolveApiDocsConfig`, `diffApiDocsOutput`, `ApiExampleFileSchema`, `WebhookExampleFileSchema`, `apiDocsLocales`, `isApiDocsLocale`, `formatApiDocsText`, `formatApiDocsProblem`, `INDEX_FILE`, `OPENAPI_FILE` and their types are now imported from `@cosmicdrift/kumiko-bundled-features/agent-tools/api-docs`. `createAgentToolsFeature` and `AGENT_TOOLS_FEATURE_NAME` are removed: the feature only logged agent doc gaps at boot, and `kumiko agent lint` reports the same gaps. Remove the feature from the app's feature list.
affects: kumiko-bundled-features/agent-tools, createAgentToolsFeature, AGENT_TOOLS_FEATURE_NAME, generateApiDocs, resolveApiDocsConfig, diffApiDocsOutput
-->
