---
"@cosmicdrift/kumiko-dev-server": patch
---

Editing a client entry file hot-reloads instead of restarting the dev server

On macOS the recursive file watcher reports paths relative to the watched directory. A change to a client entry such as `client.tsx` or a custom-named entry was therefore classified as a server change and restarted the process. The watcher now resolves the path and treats every configured entry source file as hot-reload.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Client entry edits hot-reload instead of restarting
-->
