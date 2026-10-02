---
"@cosmicdrift/kumiko-server-runtime": patch
---

Multi-entry client builds map each Bun output to its entry by exact `<base>-<hash>.js` name, so `client-admin` and `client-admin-legacy` can no longer receive each other's bundle. Static HTML with injected page head no longer sends `Last-Modified`, so a crawler sending only `If-Modified-Since` gets the fresh metadata instead of a stale 304.

<!-- kumiko-changes
feature: server-runtime
type: fix
title: Client bundle mapping matches exact entry names; page-head HTML is validated by ETag only
-->
