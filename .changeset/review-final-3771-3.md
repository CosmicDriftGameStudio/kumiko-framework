---
"@cosmicdrift/kumiko-bundled-features": patch
---

Deleting a secret under an undeclared key is rejected when the key carries the prefix of a mounted feature, so a tenant admin can no longer remove feature-owned rows outside their writeRoles. Legacy keys without a mounted-feature prefix stay deletable.

<!-- kumiko-changes
feature: secrets
type: fix
title: Feature-prefixed undeclared secret keys are not deletable
detail: The delete handler still accepts legacy undeclared keys, but a key starting with "<feature>:" of a mounted feature now fails as unknown key. Feature-owned credentials keep their writeRoles protection.
-->
