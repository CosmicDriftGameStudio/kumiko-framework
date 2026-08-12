---
"@cosmicdrift/kumiko-renderer-web": patch
---

Several bug fixes:

- **Breaking (docs only):** `WorkspaceSwitcher` now documents that it requires an ancestor `SidebarProvider` — it renders `SidebarMenuButton`, which calls `useSidebar()` internally and throws at runtime when rendered outside one. No behavior changed; a consumer rendering the switcher outside a sidebar was already crashing, this makes the requirement explicit instead of a surprise error.
- `UploadZone` no longer calls `crypto.randomUUID()` for its row keys — that API only exists in a secure context, so a plain-HTTP LAN preview left it `undefined` and threw. Row ids now come from a per-instance counter instead (they only need to be stable React keys, not globally unique).
- `EmbeddedListInput` swaps its desktop/mobile layout via a new `useIsNarrowViewport` hook (`useSyncExternalStore`-based) instead of the vendored `useIsMobile`, which only set its value in a `useEffect` — the mobile card layout previously mounted after the desktop table already built and discarded itself on every mount.
- `Drawer`'s resize handle now calls `preventDefault()` and locks `document.body`'s text selection on `PointerDown` (releasing it on `PointerUp`), matching `SidebarPanel`'s resize handle — a fast drag over the handle previously selected the drawer's text content instead of only resizing.
- `TiptapEditor`'s toolbar (bold/italic/heading/list buttons) now derives its active state via `useEditorState` instead of reading `editor.isActive(...)` directly in the render body — `@tiptap/react` v3 defaults `shouldRerenderOnTransaction` to `false`, so moving the cursor into already-bold text (without typing) previously left the toolbar frozen on the last state.
