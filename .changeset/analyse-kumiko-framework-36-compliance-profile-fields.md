---
"@cosmicdrift/kumiko-framework": minor
---

`ComplianceProfile` keeps only the fields the framework reads; 21 unused fields and the `subProcessor` and `forgetDiscovery` sections are gone.

<!-- kumiko-changes
feature: compliance-profiles
type: breaking
title: Compliance profiles drop fields no code reads
detail: A profile now holds `userRights.gracePeriod`, `userRights.exportDownloadTtl`, `userRights.exportStaleTimeoutMinutes`, `userRights.exportStorageCleanupGraceHours`, `notifications.languages`, `breach.authorityContact`, `auditLog.retention` and `tenantDestroyGracePeriod`. Removed are `userRights.restrictionAllowed`, `objectionAllowed`, `portabilityFormat`, `auskunftFrist`, `employeeAccessRight`, `explicitConsentForAutomatedDecision`, `doNotSellRequired`, `notifications.languageDefault`, `mandatoryBreachNotification`, `breach.authorityNotificationDeadline`, `userNotificationRequired`, `worksCouncilNotificationRequired`, `mandatoryRegisterOfBreaches`, `auditLog.reportFrequency` and the sections `subProcessor` and `forgetDiscovery`. No code acted on them; `restrictionAllowed: false` in particular never blocked restrict-account. `compliance-profiles:write:set-profile` rejects an override that names a removed field with `validation_error`. Overrides stored earlier keep working, their removed keys are ignored.
migration: Remove reads of the dropped fields from `compliance-profiles:query:for-tenant` results and drop them from overrides sent to `set-profile`.
-->
