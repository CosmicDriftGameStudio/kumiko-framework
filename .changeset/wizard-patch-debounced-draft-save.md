---
"@cosmicdrift/kumiko-renderer": minor
---

Fix: `controls.patch()` (the `onControlsReady`-exposed API, and extension sections such as VIN-decode) now triggers a debounced draft save, matching `handleWizardNext`/`handleWizardBack`. Previously a `patch()` on the last wizard step, or on a step abandoned without Next/Back, was silently lost on resume — forcing e.g. a repeat of a paid VIN-decode round-trip (#1908). Bursts of `patch()` calls (e.g. an `onChange` fan-out) collapse into a single save via a 500ms trailing-edge debounce, cleared on unmount and on `discardDraft()` to avoid resurrecting a just-discarded draft.
