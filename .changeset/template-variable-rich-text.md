---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer-mail-html": minor
---

templateVariable.richText declares a notification variable that carries sanitized HTML

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: templateVariable.richText for notification variables that carry formatted HTML
detail: Notification variables are escaped, so a value holding HTML (for example a document written in a rich text editor) showed up as literal tags in the mail. A variable declared with templateVariable.richText({ required }) is run through the document sanitizer at render time and inserted as HTML; bold, italic, lists and safe links stay, script, event handlers and javascript links are not emitted as markup. If the sanitizer rejects a value, it is rendered as escaped text and a warning with the violation codes is logged. All other variable types stay escaped.
-->
