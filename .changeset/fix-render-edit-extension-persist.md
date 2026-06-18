---
"@cosmicdrift/kumiko-renderer": patch
---

Fix silent custom-field data loss in `RenderEdit`. Two related extension-section
bugs:

- After a successful entity write, the boolean result of `persistExtensions()`
  was discarded and `onSubmit` fired unconditionally with the success result.
  Callers navigate away on success, unmounting the extension-error banner before
  the user could see that a custom-field section failed to persist. `onSubmit` is
  now suppressed only in the entity-success-but-extension-failure case (via the
  new `shouldNotifyCaller`); entity failures and validation blocks still notify.
- The section mount resolved its entity-id as `entityId ?? vm.id` while
  `persistExtensions` used `entityId ?? null`. The divergent `vm.id` fallback
  could mount a section editable against an id the persist step then skipped.
  Both now go through `resolveExtensionEntityId` (`entityId ?? null`), so a
  section mounted for editing is always the one that gets written.

Also adds a dev-warning when a list `header` slot names an extension-section
component that is not registered, matching the diagnostic banner edit screens
already show.
