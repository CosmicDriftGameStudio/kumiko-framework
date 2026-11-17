---
"@cosmicdrift/kumiko-guards": minor
---

The File Size guard also limits test files, at 1500 lines.

<!-- kumiko-changes
feature: guards
type: breaking
title: File Size guard limits test files to 1500 lines
detail: The File Size guard now scans tests, integration tests and e2e specs as well. Test files may have up to 1500 lines, production files still up to 1200. Existing larger test files are frozen in the same `.kumiko-file-size-baseline.json` and may only shrink.
migration: Run `kumiko-guards guards --write-baseline --guard="File Size"` once to freeze the current test files, then split the large ones by behaviour.
affects: all
-->
