---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Template, layout, draft and page bodies are sanitized within a tag and nesting budget.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: Document HTML with more than 20,000 tags or nested deeper than 512 levels is refused with a field error
detail: The document sanitizer counts the tags before it parses and measures the nesting before it scans. A body past either limit gets the violation too_many_tags or nested_too_deep (keys templateResolver.errors.document.tooManyTags and nestedTooDeep) on save, preview and validate, also for layouts, document drafts and managed pages. Before, a body of 75,000 characters nested 15,000 levels deep ended the request with a stack overflow, and a body of 200,000 characters made of tags took 0.6 s and about 900 MB of memory. The largest shipped template has about 500 tags.
-->
