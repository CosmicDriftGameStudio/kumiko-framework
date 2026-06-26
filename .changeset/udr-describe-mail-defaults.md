---
"@cosmicdrift/kumiko-bundled-features": patch
---

docs(user-data-rights): note the zero-callback mail defaults in the feature description

`user-data-rights`'s `r.describe()` now states that, with `mail-foundation` + a
`mail-transport-*` mounted, the feature sends the four GDPR notifications itself
(no app callback code, rendered in the recipient's locale) — so the generated
feature-reference page reflects the C6 mail defaults. `feature-manifest.json`
regenerated accordingly.
