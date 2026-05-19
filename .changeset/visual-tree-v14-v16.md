---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": minor
"@cosmicdrift/kumiko-dispatcher-live": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Visual-Tree V.1.4 → V.1.6 — Feature-complete Editor + Folder-Hierarchy + Roving-tabindex.

**V.1.4** — explicit `folder?: string` Schema-Field auf text-block-entity. Slug bleibt
kebab-only validiert, Folder explizit gesetzt. Tree gruppiert via `groupBlocksByFolder`
(ersetzt `groupBlocksBySlugPrefix`). `Subscribe<T>` Signature um optional `emitError`
erweitert für explicit async-error-Pfade. ProviderBranch zeigt Error-Banner mit
Retry-Button. Drift-Test pinnt seedTextBlock-vs-set.write Slug-Validation.

**V.1.4b** — URL-State-Routing für Editor-Target via `nav.searchParams`. F5 + Back-Button
stellen den Editor-State wieder her. Format: `?t=text-content:edit&a_slug=...&a_lang=...`.
Plus `useDispatchTarget` hook ersetzt globalen `dispatchTarget` als empfohlenen Production-
Pfad (legacy bleibt für Test-Hooks).

**V.1.5** — Arrow-Key-Navigation (`<aside role="tree">`, ARIA-tree-Pattern) + SSE-driven
Tree-Refresh. `ClientFeatureDefinition.treeEntities?: string[]` listet Entity-Namen pro
Provider; live-events triggern provider-re-mount → Stale-Tree-state="stub"→"filled"
flippt nach save automatisch.

**V.1.5c+d** — Active-Node-Highlight (explicit blue + 2px border-l + scrollIntoView),
VS-Code-Polish (compact spacing, focus-visible, folder-icon-color text-amber, indent-
guides per ancestor-depth), Folder-Wrapper für legal-pages ("📁 Legal" + slug-first
Verschachtelung) und text-content ("📁 Content").

**V.1.6** — Multi-level Folder-Splitting (`folder="page/marketing"` → nested folders,
walk-or-create-pattern, folder/leaf-collision-tolerant). Roving-tabindex (nur focused-
treeitem hat tabIndex=0, Tab cyclt aus dem Tree raus).

35/35 kumiko check PASS, 13/13 group-blocks + 22/22 text-content integration tests grün.
Browser + Keyboard lokal validated.

**Breaking**: `TreeContext` Type entfernt (V.1.2 SR2-Rip — war nie genutzt). Provider sind
session-bound: `TreeChildrenSubscribe = () => Subscribe<T>` statt `(ctx) => Subscribe<T>`.

**V.1.7-Followups**: useEffect-deps in VisualTree-focus-init (Performance), Cancellation-
Token in TreeProvider's fetch (emit-after-unmount-warning), inline-rename, drag-drop,
file-icons per slug-extension, parent-jump bei ArrowLeft auf collapsed-item.
