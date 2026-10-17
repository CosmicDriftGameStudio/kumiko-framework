---
"@cosmicdrift/kumiko-guards": patch
---

comment-lang: fewer false positives, division detection after keywords and non-null, push checks HEAD

<!-- kumiko-changes
feature: guards
type: fix
title: comment-lang needs two lower-case markers, scans HEAD in touched mode and recognises division after keywords
detail: The short German markers now match case-sensitively in lower case and need two hits, so a licence header such as "MIT License" no longer counts; an umlaut alone still does. The scanner treats a slash after contextual keywords (from, type, get, of, ...) and after the non-null postfix as division instead of a regex, so a German comment after "width! / 2" is no longer hidden. --touched compares the diff of mergeBase to HEAD and scans the file contents from HEAD, so the pre-push hook checks the commits being pushed rather than local uncommitted edits.
-->
