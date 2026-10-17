---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
"@cosmicdrift/kumiko-document-designer": patch
---

Template conditions with data-if and a percent variable type

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Template conditions with data-if and a percent variable type
detail: A paragraph, heading or table row with data-if="name" renders only when the variable has a value (0 counts as a value); inside a repeat row the name refers to the row field, on the repeat row itself to the root variable. The sanitizer keeps the attribute, and template validation reports a condition on an undeclared variable. New variable type percent (templateVariable.percent()) takes percentage points and renders locale-aware, 12 as "12 %" in German and "12%" in English; the preview uses its example value. The document designer has no toolbar control for conditions yet; the attribute survives editing.
-->
