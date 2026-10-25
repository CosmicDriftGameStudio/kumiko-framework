---
"@cosmicdrift/kumiko-guards": minor
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-framework": patch
---

Two new guards: `test-title` flags German or issue-referencing test titles, and `ignore-tag-reason` flags `kumiko-lint-ignore` tags without a real reason. The comment-language guard no longer flags names like "Müller GmbH" or "Zürich".

<!-- kumiko-changes
feature: guards
type: improvement
title: New test-title and ignore-tag-reason guards, fewer comment-language false positives
detail: test-title scans test, it and describe titles (including each/skip/only chains) for German text and issue references. ignore-tag-reason requires a kumiko-lint-ignore reason of at least three words that is not generic. Both start with a baseline of 0 and warn only in repos without a baseline. The comment-language guard now reports a comment only when a lowercase word contains an umlaut, an umlaut appears together with a German function word, or at least two German markers appear, so proper nouns with umlauts pass.
-->
