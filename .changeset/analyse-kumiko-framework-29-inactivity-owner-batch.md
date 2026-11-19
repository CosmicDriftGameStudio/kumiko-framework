---
"@cosmicdrift/kumiko-bundled-features": patch
---

The inactivity job loads all owner accounts of a tenant in one query.

<!-- kumiko-changes
feature: tenant-inactivity
type: improvement
title: Inactivity warnings load all owner accounts in one query
detail: The inactivity job reads the locale of all owners of a tenant in one query instead of one query per owner. Recipients and mail language are unchanged.
-->
