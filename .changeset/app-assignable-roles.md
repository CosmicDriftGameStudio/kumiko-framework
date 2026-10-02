---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-server-runtime": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-types": minor
---

Apps declare assignable membership roles via `r.useExtension(EXT_ASSIGNABLE_ROLE, "<Role>", { assignableFrom? })` (the feature must `r.requires("tenant")`). `assignableFrom` defaults to "Admin"; set it higher to raise the bar. The role-elevation guard and the members/invite screens pick the declarations up; undeclared roles stay rejected. "Member" is now ranked with "User" and labelled.

<!-- kumiko-changes
feature: tenant
type: improvement
title: Apps declare assignable membership roles via EXT_ASSIGNABLE_ROLE
-->
