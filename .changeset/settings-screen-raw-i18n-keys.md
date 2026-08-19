---
"@cosmicdrift/kumiko-framework": patch
---

Fixes three raw-i18n-key regressions found during a visual QA pass over the `use-all-bundled` sample app.

**Settings-Hub double label:** `tenant-settings` declares an admin-write config key at tenant scope, which the Settings-Hub generator (`buildConfigFeatureSchema`) cascades into a second, system-scope screen for `SystemAdmin` alongside the tenant-home screen. Both screens used to share the exact same `${feature}.settings` nav label and section title, and neither key was ever declared in `tenant-settings`'s translations — so the sidebar rendered the raw key `tenant-settings.settings` twice, once under "Platform" and once under "Organization". Fixed by declaring `tenant-settings.settings` (en/de) and adding an opt-in scoped override `tenant-settings.settings.system`, following the same declare-if-present gate the generator already uses for section descriptions. `subscription-stripe` is the only other bundled feature with a masked config key; it's system-scope-only (no cross-scope cascade) and already declared its `.settings` key, so no change was needed there.

**`ComplianceProfileCatalog` not registered:** `samples/apps/use-all-bundled`'s `client.tsx` mounted `compliance-profiles` and `feature-toggles` server-side but never called their client plugins, so `/profile-picker`'s extension section and the feature-toggles admin screen both failed to render. Added the missing `complianceProfilesClient()` and `featureTogglesClient()` calls. A new coverage test cross-references every bundled feature the app mounts server-side (`run-config.ts`) against `client.tsx`'s client-feature list, so a future gap fails CI instead of shipping silently.

**Raw `kumiko.actions.view` key:** `user-data-rights`'s export-job-list screen follows the established `kumiko.actions.*` row-action convention (same as `tenant`/`user` screens), but `kumiko.actions.view` was never declared in the framework's own default translation bundle (`renderer/src/i18n-defaults.ts`) — every mounting app rendered the raw key. Added `kumiko.actions.view` to the English default bundle and to `locale-de`/`locale-es`.

Also surfaced but deliberately out of scope for this PR: the boot-time i18n validator (`isI18nKey` in `framework/src/i18n/required-surface-keys.ts`) only recognizes colon-containing keys, so dot-form keys like `${feature}.settings` are silently excluded from required-translation checks — this is why the missing `tenant-settings.settings` key was never caught at boot. Filed as #2260.
