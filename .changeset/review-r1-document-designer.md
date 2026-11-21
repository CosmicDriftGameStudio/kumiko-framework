---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

Document editor and PDF fixes: fold marks only on upright A4, read-only and repeat-row guards in the table toolbar, template import cannot double-submit, draft creation refuses an unsanitizable template.

<!-- kumiko-changes
feature: document-designer
type: fix
title: Document editor and PDF print review fixes
detail: DIN fold and punch marks are printed and previewed only on upright A4 (shared `PDF_FOLD_MARK_POSITIONS_MM` and `isFoldMarkPaper`); Letter and landscape sheets get none. The table toolbar locks number fields and image alignment in a read-only editor and no longer removes the repeat or repeated-header row. The PDF editor disables "import from template" while the import handler runs. `document-draft:create` answers with a validation error instead of copying template HTML that fails the sanitizer.
-->
