---
"@cosmicdrift/kumiko-guards": minor
---

Add runner parity with the private infra/guards package: broker-subscribe, error-reasons, i18n-keys, i18n-locale-mount, pii-annotations and text-field-stance guards are now registered in the shared runner, and the escape-hatch-declared guard recognizes an explicit `withUnsafeRawGrant(...)` call as a declared grant instead of flagging it.

<!-- kumiko-changes
feature: guards
type: feature
title: Add runner parity with the private infra/guards package
-->
