---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-cli": minor
---

`kumiko ops waitlist-migrate` and the legacy waitlist migration exports are removed; an app imports its own legacy rows with `importWaitlistEntry`.

<!-- kumiko-changes
feature: waitlist
type: breaking
title: Legacy waitlist migration removed, apps import with importWaitlistEntry
detail: The CLI op `kumiko ops waitlist-migrate` and the exports `migrateLegacyWaitlist`, `offlotLegacyTable`, `publicstatusLegacyTable`, `LEGACY_WAITLIST_SOURCES`, `isLegacyWaitlistSource`, `DEFAULT_LEGACY_SOURCE_TABLE`, `DEFAULT_IMPORT_LOCALE` and the types `LegacyWaitlistMigrateOptions`, `LegacyWaitlistMigrateReport` and `LegacyWaitlistSource` are gone from `@cosmicdrift/kumiko-bundled-features/waitlist`. They hard-coded the row formats of two apps into the framework. `importWaitlistEntry`, `waitlistImportId` and the `WaitlistImportEntry` type stay.
migration: Map each legacy row to a `WaitlistImportEntry` in an app seed and call `importWaitlistEntry(db, entry)` with a system-tenant `TenantDb`; a stable `sourceKey` such as `<app>:<row id>` makes the seed idempotent. Then drop the legacy table in a migration.
affects: waitlist-migrate, migrateLegacyWaitlist, offlotLegacyTable, publicstatusLegacyTable, LEGACY_WAITLIST_SOURCES, isLegacyWaitlistSource, DEFAULT_LEGACY_SOURCE_TABLE, DEFAULT_IMPORT_LOCALE, LegacyWaitlist
-->
