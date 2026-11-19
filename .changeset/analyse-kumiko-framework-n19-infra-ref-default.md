---
"@cosmicdrift/kumiko-dev-server": patch
---

Managed workflows pin the framework's infra tag when kumiko.deploy.infraRef is unset.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Managed CI follows the framework's infra tag unless the app sets infraRef
detail: ci.yml and release.yml render the infra reusables at CURRENT_INFRA_REF (now reusables-v2.4.5) when package.json#kumiko.deploy.infraRef is unset, instead of @main. `kumiko check managed` and `kumiko sync-managed` no longer report a missing infraRef, and `kumiko new app` writes kumiko.deploy.infraRef only when an infraRef option is passed. A set infraRef still overrides the tag.
-->
