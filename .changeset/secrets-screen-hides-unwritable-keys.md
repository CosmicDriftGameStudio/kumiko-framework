---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-types": patch
---

The generated secrets screen now hides fixed secret keys the current user may not write according to the key's `writeRoles`, and drops sections left without visible keys. The generator emits a per-field `fieldAccess` map on the screen for this. It only affects what the UI shows; the server-side write check is unchanged and still decides.

<!-- kumiko-changes
feature: renderer
type: improvement
title: Secrets screen hides keys the user cannot write
-->
