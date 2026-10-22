---
"@cosmicdrift/kumiko-guards": patch
---

Guard accuracy fixes: import types, mock.module and template literals in import-extensions, no file-name false positives in comment-issue-ref-only, entity registrations with constant or shorthand names, direct writes on package catalog tables without own ES tables, and neutral rewrite commands.

<!-- kumiko-changes
feature: guards
type: fix
title: Guards report fewer false results
detail: The import-extensions guard now also checks import types, mock.module and template-literal specifiers. The comment-issue-ref-only guard no longer treats file names like round2.ts as plan labels. The direct-entity-writes guard recognises r.entity registrations with a constant or shorthand name, reports direct writes on package catalog tables even when the scope has no own ES tables, keeps receiver text on one line and names the installed kumiko-guards bin in its catalog rewrite hint. The app-feature-structure guard no longer tells dev/ and scripts/ files to move under web/, and the bundled license exceptions drop the stale first-party and create-kumiko-app entries.
-->
