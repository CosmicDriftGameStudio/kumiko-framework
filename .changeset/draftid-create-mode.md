---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Fix: two parallel create sessions on the same wizard screen no longer collapse onto the same `draftKey` and silently overwrite each other (#1908). `RenderEdit` now mints a client-side `draftId` (UUID) on the first step change in create-mode and persists it via the new `DraftStorage` context (`@cosmicdrift/kumiko-renderer-web` supplies a `sessionStorage`-backed default, `createBrowserDraftStorage`). If no `draftId` survived (new tab, cleared storage), `RenderEdit` falls back to `form-draft:query:list` and either auto-adopts a single open draft or shows a picker for multiple. Edit-mode `draftKey` (`${screenId}:${entityId}`) is unchanged.
