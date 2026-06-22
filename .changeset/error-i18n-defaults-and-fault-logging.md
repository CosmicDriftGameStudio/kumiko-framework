---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-renderer": patch
---

Diagnosability + i18n completeness for error paths.

- The HTTP layer now logs unexpected server faults (5xx) at the boundary with the failing handler `type` and the original `cause` stack. Previously a wrapped throw (`InternalError{cause}`) returned a 500 with **zero log lines** — undiagnosable in prod. Expected 4xx outcomes stay unlogged (no noise).
- Added the generic `errors.*` default translations (`errors.internal`, `errors.notFound`, `errors.access.denied`, `errors.conflict`, `errors.versionConflict`, `errors.uniqueViolation`, `errors.unprocessable`, `errors.unconfigured`, `errors.feature.disabled`, `errors.rate_limited`) plus `errors.download.urlMissing` to the framework default bundle, so no consumer ever renders a raw i18n key as the user-facing message.
