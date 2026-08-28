---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
---

`projectionDetail` screens can now declare `EditExtensionSection`s that persist through their own dispatcher writes (e.g. a notes/history block), motivated by solon#264 losing a hand-written `NotesSection` with no declarative equivalent. The boot-validator only rejects an extension section when `contributesToFormSubmit: true` — there is no form submit on a read-only detail screen. Extension sections can also declare `entityName` to override the host-derived value passed to the mounted component; on `projectionDetail` this is required, since the screen has no real entity to derive one from.
