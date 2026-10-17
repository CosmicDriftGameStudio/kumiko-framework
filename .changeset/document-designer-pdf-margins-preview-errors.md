---
"@cosmicdrift/kumiko-document-designer": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-puppeteer-client": patch
---

PDF editor saves only the margins that are set; preview and error handling fixes

<!-- kumiko-changes
feature: document-designer
type: fix
title: PDF editor keeps unset margins unset, frees old PDF previews, and shows reset and diff errors
detail: Setting one margin no longer stores the other three as 15 mm, so the layout's header and footer margins still apply to them. The PDF preview no longer re-renders pages or stacks text layers on re-render and destroys the previous document. A failed reset to the system version shows an error banner in the PDF and mail editors, and a failing diff query shows an error state with retry instead of loading forever. The canvas reserves the footer margin like the renderer. Page formats, orientations and default margins now come from template-resolver (new exports PDF_ORIENTATIONS, PDF_DEFAULT_MARGIN_MM, PDF_HEADER_MARGIN_MM, PDF_FOOTER_MARGIN_MM, PdfOrientation).
-->
