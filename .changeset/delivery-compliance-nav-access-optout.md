---
"@cosmicdrift/kumiko-bundled-features": patch
---

`createDeliveryFeature` and `createComplianceProfilesFeature` accept a new optional `access` option (defaults to `access.admin`, unchanged from before). It narrows the feature's screen and the handler it reads/writes together, so a role that can't see the nav entry never had a callable handler underneath it either — previously the two could drift apart, leaving no way to opt a role out of the nav entry without also losing handler access, or vice versa.
