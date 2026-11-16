---
"@cosmicdrift/kumiko-bundled-features": patch
---

Agent manifests reuse each handler's input JSON schema instead of recomputing it every turn.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Handler input schemas are computed once per handler
detail: `buildAgentManifest` ran `z.toJSONSchema` for every exposed handler on every agent turn. The schema is now cached per handler definition, including schemas that cannot be expressed as JSON Schema. Manifest and catalog are still built per turn, because they depend on roles, locale and the deny list.
-->
