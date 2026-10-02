---
"@cosmicdrift/kumiko-framework": patch
---

`parseTrustedProxyHopsEnv` treats an empty `KUMIKO_TRUSTED_PROXY_HOPS` as unset, so a blank `.env` template line no longer crashes the dev boot while prod ignored it. The published package also no longer ships the unusable compiled `dist/scripts/` codemod copies.

<!-- kumiko-changes
feature: framework
type: fix
title: Empty KUMIKO_TRUSTED_PROXY_HOPS is treated as unset, and dist no longer ships compiled codemods
-->
