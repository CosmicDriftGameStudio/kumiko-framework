---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Adds AI-agent tooling: `description`/`agent` slots on `r.writeHandler`/`r.queryHandler` feature-ast patterns, `createAgentToolsFeature()` with a boot check that warns (never throws) on handlers/screens/entities the agent can't describe, `findAgentDocGaps` for surfacing those gaps programmatically (also wired into this repo's own `kumiko agent lint` dev command), and an `AgentReasons` error-reason catalog. Also adds the tool catalog and write-dispatch layer that turns an `AgentManifest` into a model-facing tool list (`get`/`list`/`query`/`write`/`navigate`/`open_form`).

**Breaking:** `buildToolCatalog(registry)` becomes `buildToolCatalog(registry, manifest, options)`, where `options: ToolCatalogOptions` is `{ mode }` only — role filtering and locale are no longer passed in separately, they're read off the manifest (`manifest.builtForRoles`, `manifest.tenantSettings.locale`), closing a divergence where a caller could pass a role/locale pair that didn't match the manifest's own. `AgentManifest` gains `builtForRoles` (the roles the manifest was built for) as that single source. Callers pass the already-built manifest as the second argument and drop any separate roles/locale options.
