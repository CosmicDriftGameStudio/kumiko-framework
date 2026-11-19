---
"@cosmicdrift/kumiko-guards": patch
---

The i18n keys guard reads installed framework keys only from the app's own `node_modules/@cosmicdrift`.

<!-- kumiko-changes
feature: guards
type: fix
title: i18n keys guard no longer walks the file system from the root
detail: To find the keys of the installed framework packages, the guard handed absolute globs to ts-morph. When the app lay outside the current working directory, the glob walked from `/` and could take minutes; glob characters in the app path also matched sibling folders. The guard now globs relative to each `node_modules/@cosmicdrift` folder.
-->
