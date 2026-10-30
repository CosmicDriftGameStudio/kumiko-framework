---
"@cosmicdrift/kumiko-dev-server": patch
---

The dev file watcher no longer exits the server for restart events on files that were not modified since the watcher started. macOS FSEvents can report such events, which killed servers started directly without the kumiko-dev wrapper.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Dev watcher ignores restart events on unchanged files
detail: startDevFileWatchers records the watcher start time and skips a restart when the changed file's mtime is older than that start. A failing stat (deleted or renamed file) still restarts. Known limit: a file copied in with a preserved older mtime (cp -p, rsync -a) no longer triggers a restart.
-->
