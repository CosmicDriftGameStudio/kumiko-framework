---
"@cosmicdrift/kumiko-framework": patch
---

Anonymous query handlers can declare access.personalData: "public-intake" so personal data they write (for example an audit row with the caller's IP) passes the write gate.

<!-- kumiko-changes
feature: framework
type: fix
title: Query handlers may declare personalData public-intake
detail: |
  The personal-data write gate computed the public-intake exemption only for write handlers, so an anonymous query handler that wrote personal data (directly or through a nested write) was always rejected, and the boot validator refused access.personalData on query handlers. Query handlers now follow the same rules as write handlers: access.personalData "public-intake" requires the anonymous role and an active rateLimit (not disabled). openToAll.personalData stays write-only, stream handlers still cannot declare personalData.
migration: No consumer change; anonymous query handlers that write personal data now declare access.personalData: "public-intake" instead of failing at the write gate.
-->
