---
"@cosmicdrift/kumiko-bundled-features": minor
---

delivery requires tenant

<!-- kumiko-changes
feature: delivery
type: breaking
title: delivery requires tenant
migration: |
  delivery now declares r.requires("tenant") because its delivery-log screen references tenant:tenant. Stacks that mount delivery must also mount createTenantFeature() (and its config dependency).
-->
