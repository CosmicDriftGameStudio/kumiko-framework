---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Reading widgets for an inbox: mail thread with attachments, a PDF viewer with thumbnails and search, a step list for AI proposals, and sand and blue surfaces.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Inbox reader widgets (MessageThread, MessageReader, StepList, surfaces, PdfPreview viewer)
detail: New web widgets MessageThread and MessageReader (older messages fold to one line, quoted text behind a toggle, HTML bodies in a sandboxed script-free iframe with external images blocked until the reader asks, attachment chips and tabs), StepList (progress header, status icons, per-step actions, collapsedAfter), and the surfaces SenderFrame, SenderSheet and AiSurface backed by new theme tokens sender-frame, sender-frame-border, sender-sheet, ai-surface, radius-sheet and shadow-sheet. PdfPreview gains variant "viewer" (thumbnail rail, page jump, zoom, search with highlighted hits), searchTerm, initialPage and onPageChange; both variants now render pages lazily as they scroll into view. New i18n keys kumiko.widget.pdf-preview.*, message-thread.*, message-reader.* and step-list.* ship in de, es, fr and it.
-->
