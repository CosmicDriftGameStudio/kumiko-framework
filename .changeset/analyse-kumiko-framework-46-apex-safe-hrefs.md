---
"@cosmicdrift/kumiko-renderer": patch
---

Apex pages render links with an unsafe URL scheme as `#`.

<!-- kumiko-changes
feature: renderer
type: fix
title: Apex links only keep safe URL schemes
detail: `renderApexPage` and `renderApexHeader` check every link href (CTAs, header brand and nav, dropdown items and footer, footer columns) with `isSafeHref`, the same check as the Link primitive and the markdown renderer. A `javascript:`, `data:` or `vbscript:` href, also entity-encoded or in mixed case, renders as `#`; relative paths, anchors, http(s), mailto and tel links stay. `metaHtml` and feature or menu icons are still rendered verbatim and must stay app-authored.
-->
