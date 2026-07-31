---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Reference-field comboboxes now offer a "+ Create" footer that opens the referenced entity's create screen in a modal, selects the newly created record, and refreshes the option list — no more leaving the current form to create a missing referenced record first (#1681).

Adds a new `Modal` core primitive (bare content shell for hosting self-contained forms in an overlay) and `AppFeaturesProvider`/`useAppFeatures` for cross-feature schema access.
