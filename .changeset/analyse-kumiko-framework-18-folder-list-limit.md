---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The folder manager and the folder picker load up to 200 folders and say so when a tenant has more.

<!-- kumiko-changes
feature: folders
type: fix
title: Folder tree and picker no longer stop silently at 50 folders
detail: `FolderManager` and `FolderSection` asked for the folder catalog without a limit and got the default page of 50, so larger trees lost nodes and paths without notice. Both now request `limit: 200`, the list maximum, and show a warning banner (`folders.list.truncated`, test ids `folder-manager-truncated` and `folder-section-truncated`) when the catalog has further pages.
-->
