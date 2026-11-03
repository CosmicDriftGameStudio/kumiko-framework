---
"@cosmicdrift/kumiko-guards": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Pre-push review fixes: stable editor handle reporting, backslash-aware guard prefilter, Dockerfile heredoc detection, IMAP host normalization.

<!-- kumiko-changes
feature: guards
type: fix
title: Backslash-aware escape prefilter, Dockerfile heredoc start, stable editor handle report, IMAP host key
detail: The escaped-literal prefilter treats every backslash as a possible escape, so identity escapes and backslash-newline continuations no longer hide a literal from the RLS-setting, test-ES-fixture and test-ES-row-write guards. The Dockerfile heredoc start ignores `<<<` herestrings and `$((1 << x))` shifts, so later stages are still inspected. The template editor reports its handle once per editor instance again (the reporting callback is read through a ref), instead of re-reporting on every render. The IMAP connect-target rate limit strips a trailing dot from the host before keying its buckets. Several tests are sharpened (parallel ingest progress, batch hooks, consumer audit, pre-push lane order).
-->
