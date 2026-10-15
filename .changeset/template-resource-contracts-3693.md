---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

Template contracts: PDF meta, render provenance, system lifecycle, usage and override queries

- `document-pdf` templates take a strict meta (layoutSlug, pageFormat, margins in mm, fileName, metadata); `readPdfTemplateMeta` reads it for the PDF renderer.
- `RenderResponse` carries `template` and `layout` (id, version, scope) of the rows a mail was rendered from; the mail renderer fills them.
- New write handlers `publish-system`, `archive-system` (SystemAdmin) and `reset-to-system` (archives a tenant override); `publish` and `archive` now refuse system rows.
- New queries `usage`, `tenant-overrides` (counts only) and `diff-to-system`; `find-by-id` also returns `meta`.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: PDF template meta, render provenance, system template lifecycle and override queries
detail: kind document-pdf takes a strict meta (layoutSlug, pageFormat A4/Letter, margins in mm, fileName without / \ " ; or .., metadata title/author); new exports PDF_PAGE_FORMATS, PdfPageFormat, PdfTemplateMeta, readPdfTemplateMeta, DEFAULT_MAIL_LAYOUT_SLUG. RenderResponse (renderer-foundation) gains optional template and layout refs ({ templateId, templateVersion, scope }, new types RenderedTemplateRef and RenderProvenance); renderer-mail-html fills them. New handlers template-resolver:write:publish-system and archive-system (SystemAdmin), reset-to-system (TenantAdmin, SystemAdmin), queries usage, tenant-overrides (SystemAdmin, counts only) and diff-to-system. publish and archive answer not_found for rows outside the caller's tenant instead of a version_conflict; find-by-id also returns meta.
-->
