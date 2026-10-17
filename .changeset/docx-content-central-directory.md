---
"@cosmicdrift/kumiko-framework": patch
---

docx content check reads ZIP entry names instead of searching bytes

<!-- kumiko-changes
feature: framework
type: fix
title: A .docx upload must contain a word/ entry, not just the bytes "word/"
detail: validateFileContent now reads the ZIP central directory and requires an entry name that starts with word/. ZIPs with entries such as password/a.txt or xl/word/sheet.xml, or the bytes appearing anywhere in the file, are rejected as content_mismatch.
-->

<!-- kumiko-changes
feature: framework
type: improvement
title: zipWithEntries test helper in @cosmicdrift/kumiko-framework/testing
detail: Builds a minimal ZIP with a real central directory for upload tests. Hand-made docx fixtures that only had a local header and the word/ bytes no longer pass the content check; build them with zipWithEntries("word/document.xml") instead.
-->
