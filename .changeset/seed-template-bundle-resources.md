---
"@cosmicdrift/kumiko-bundled-features": minor
---

Template bundles with a logo can be seeded

<!-- kumiko-changes
feature: template-resolver
type: improvement
title: Template bundles with a logo can be seeded
detail: seedSystemTemplateBundle(db, bundle, { dispatcher }) now seeds bundles that carry resources such as a logo by running the import-bundle-system write on the given seed dispatcher. With ifExists "skip" (default) nothing is written when every locale row already exists; if only some exist, the whole bundle is imported again. Without a dispatcher such a bundle still fails with a message that names the missing option.
-->
