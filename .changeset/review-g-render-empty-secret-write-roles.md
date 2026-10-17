---
"@cosmicdrift/kumiko-framework": patch
---

Feature AST rendering drops an empty writeRoles list on secrets

<!-- kumiko-changes
feature: framework
type: fix
title: render/parse roundtrip keeps secrets valid when writeRoles is empty
detail: renderSecret and renderSecretNamespace omit writeRoles when the list is empty so the rendered source parses back to the same definition.
-->
