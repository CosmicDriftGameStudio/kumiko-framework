---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-mail-html": patch
"@cosmicdrift/kumiko-framework": patch
---

Rich text placeholders no longer nest paragraphs

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Rich text placeholders no longer nest paragraphs
detail: A richText placeholder alone in a paragraph compiles into a div that keeps the paragraph attributes, and one inside other text renders inline with line breaks instead of its own paragraphs. Mails and PDFs no longer contain <p><p>. richText and stepIs are now reserved template variable names, like the other renderer helpers.
migration: A notification that declares a template variable called richText, stepIs or percent fails at boot; rename the variable.
-->
