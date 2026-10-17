---
"@cosmicdrift/kumiko-framework": minor
---

Handler input references work on nested fields and record keys

<!-- kumiko-changes
feature: framework
type: improvement
title: Handler input references work on nested fields and record keys
detail: The references meta on handler input schemas is now found on fields inside arrays, nested objects and records, and on record keys. The new readHandlerFieldReferences and handlerFieldReferences return each hit with a path such as "channels[].channelKey" or "labels{key}" plus typed path segments. Boot validation checks nested references too and names the path in its error message. readHandlerFieldReference and handlerFieldReference behave as before.
-->
