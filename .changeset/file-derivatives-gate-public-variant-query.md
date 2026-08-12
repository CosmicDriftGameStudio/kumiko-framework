---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createFileDerivativesFeature()` called without `resolveApexTenant` no longer registers the `publicVariant` query handler at all — previously it was still registered as a side effect of `r.queryHandler(...)`, so `file-derivatives:query:public-variant` (access: `["anonymous", ...]`) was dispatchable through the generic `/api` query path for any consumer with `anonymousAccess` wired, even with the anonymous `/media/:fileRefId/:variant` httpRoute unmounted. On that path `tenantId` came from the `anonymousAccess` resolution instead of the host, bypassing the feature's "tenantId only from the host" invariant. Without `resolveApexTenant`, `publicVariant` is now unreachable via both the httpRoute and the `/api` query dispatch.
