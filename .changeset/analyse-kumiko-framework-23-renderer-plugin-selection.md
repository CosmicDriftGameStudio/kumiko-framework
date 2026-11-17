---
"@cosmicdrift/kumiko-bundled-features": minor
---

`selectRendererPlugin(plugins, kind)` replaces `createRendererFoundationApi(plugins).createRendererForTenant({ tenantId, kind })`; the documented per-tenant plugin override never existed and is gone.

<!-- kumiko-changes
feature: renderer-foundation
type: breaking
title: Renderer plugins are picked by kind with selectRendererPlugin
detail: The renderer for a kind is the mounted plugin named in `DEFAULT_PLUGIN_BY_KIND`, otherwise the first mounted plugin serving the kind, otherwise `RendererError("no_plugin_for_kind")`. The tenant override through a `rendererPluginByKind` config key was documented, but no caller ever passed a lookup and no such key was registered, so it is removed together with its parameter. `createRendererFoundationApi`, the type `RendererFoundationApi` and `requireRendererFoundation` are removed; no code read `rendererFoundation` from the extra context.
migration: Replace `createRendererFoundationApi(collectRendererPlugins(registry)).createRendererForTenant({ tenantId, kind })` with `selectRendererPlugin(collectRendererPlugins(registry), kind)` and drop a `rendererFoundation` entry from `extraContext`.
-->
