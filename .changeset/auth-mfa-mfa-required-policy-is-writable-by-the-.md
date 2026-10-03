---
"@cosmicdrift/kumiko-bundled-features": minor
---

MFA required policy is writable by the system only

<!-- kumiko-changes
feature: auth-mfa
type: breaking
title: MFA required policy is writable by the system only
migration: |
  Tenant admins can no longer write auth-mfa:config:required (write access is now system-only). Set the app-wide default with createAuthMfaFeature({ requiredPolicy }) / the mfa options and per-tenant overrides with runBootstrap tenants[].config or a system write (createSystemUser). Code that wrote the key as TenantAdmin/Admin/SystemAdmin over HTTP must switch to one of these.
-->
