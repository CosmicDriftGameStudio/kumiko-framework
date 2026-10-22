---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

`patch-draft` `replaceText` now says why a find that is visible in `document-blocks` does not match. A find that crosses a formatting change fails with `text_spans_formatting`, and a find containing a `{{placeholder}}` fails with `placeholder_not_replaceable`, instead of `text_not_found`. The handler description names the limit: the text must lie within one formatting run and cannot contain a placeholder.

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: replaceText explains finds across formatting or placeholders
detail: replaceText matches inside single text nodes so formatting stays intact. A find that appears in the block line but crosses a formatting change now fails with text_spans_formatting, and a find with a {{placeholder}} fails with placeholder_not_replaceable, both with translated messages. Only a string that is not in the block at all still gives text_not_found.
-->
