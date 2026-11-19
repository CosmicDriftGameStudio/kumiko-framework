---
"@cosmicdrift/kumiko-bundled-features": patch
---

Server code can label folders with their full path through the folders entry point, without importing the React client barrel.

<!-- kumiko-changes
feature: folders
type: improvement
title: Folder tree helpers on the server-neutral folders entry
detail: `buildFolderTree`, `folderPath`, `FolderRow` and `FolderNode` are now exported from `@cosmicdrift/kumiko-bundled-features/folders` as well as from `/folders/web`. Server handlers that build filter options with folder paths can import them there instead of copying the path walk.
-->
