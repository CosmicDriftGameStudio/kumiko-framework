---
"@cosmicdrift/kumiko-server-runtime": minor
---

Exports resolveStoredUserEmail and the feature-toggles wiring; passes the registry to the template resolver.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: resolveStoredUserEmail and resolveFeatureTogglesOption exported
detail: resolveStoredUserEmail (with MailRecipientScope) and resolveFeatureTogglesOption with its binding types are available from the package entry. The production boot builds the template resolver API with the registry.
-->
