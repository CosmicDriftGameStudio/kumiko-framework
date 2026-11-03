---
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review round 2, document designer: an archived template with an open draft keeps its archived status in the editor, editor handles follow a changed `onEditorReady` callback, and unreachable null guards and duplicated types in the designers are gone.

<!-- kumiko-changes
feature: document-designer
type: fix
title: review round 2 document designer fixes
detail: `toWorkingRow` keeps `archived` for an archived row with an open draft instead of reporting it as a draft, so find-by-id and layout-source show the template as archived and publish brings the draft back. `useEditorHandleReport` re-reports the handle when `onEditorReady` changes on a standing editor and unregisters the old callback. The repeat-bar list label ignores inherited object keys. Dead null guards in the PDF and mail editors, the redundant variable guard in the insert panel and the unused bullet-list text are removed, and the copies of `Translate`, `Primitives` and the selected-block type now come from one place. Tests cover the PDF editor's branding query without managed-pages and drop an unsafe cast.
-->
