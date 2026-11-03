---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-cli": patch
---

Agent manifest, tool dispatch and API-docs generator fixes from the second review round.

<!-- kumiko-changes
feature: agent-tools
type: fix
title: agent manifest, tool dispatch and api-docs review fixes
detail: The manifest takes feature ownership from the registry instead of qualified-id prefixes, keeps features that only contribute a visible workspace, shares the entity reachability rule with the tool catalog (`isExplicitlyAgentHidden` is no longer exported), splits feature descriptions at ./!/? while keeping abbreviations whole, and cuts long ones by code point with a trailing ellipsis. A write tool without a detail handler to read its version from is now a logged internal error instead of `invalid_tool_call`. API docs: root `$ref: "#"` in input schemas points at the payload schema, only the real token feature is documented, empty translations count as gaps, entity labels stay boundary- and feature-aware, webhook examples must match the contract version (new problems `webhookExampleVersionMismatch`, `unusedWebhookExample`, `scopeSlugCollision`), and `resolveApiDocsConfig` gives the CLI and the recipe golden test one config resolution.
-->
