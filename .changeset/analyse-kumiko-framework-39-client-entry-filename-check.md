---
"@cosmicdrift/kumiko-server-runtime": patch
---

The production build no longer scans `src/` for old `client-<suffix>.tsx` entry files.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: No migration check for filename-based client entries
detail: Without `kumiko.clientEntries` or `kumiko.clientEntry` and without `src/client.tsx` or `src/client.ts`, `resolveClientEntries` threw a migration error when `src/` held files named `client-<suffix>.tsx`, a convention removed long ago. Every app declares its entries, so the check is gone, and such a project builds without a client bundle like any project without a client entry.
-->
