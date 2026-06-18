---
"@cosmicdrift/kumiko-framework": patch
---

Review-fix mechanical batch: register `auth.errors.originNotAllowed` i18n key (de+en) used by origin-middleware; share the config read-redaction `MASKED` constant across the cascade/values query handlers; align Dockerfile `BUN_VERSION` to CI (1.3.14); use `SYSTEM_TENANT_ID` and an `isErrorBody` type-guard instead of hardcoded UUID / unchecked casts in tests.
