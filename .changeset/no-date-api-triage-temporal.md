---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-server-runtime": patch
---

Migrate three display/build-tooling timestamp call-sites from native `Date` to `Temporal` (identical output format): `formatWhen` (operator-screen timestamps), `formatDateCell` (table-cell date/timestamp formatting, preserves the existing `dateStyle`/`timeStyle` priority order), and `build-prod-bundle`'s `builtAt` field. Surfaced by infra#286's `no-date-api` guard, which now actually scans these packages instead of silently skipping them.
