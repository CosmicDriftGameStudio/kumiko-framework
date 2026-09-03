---
"@cosmicdrift/kumiko-bundled-features": minor
---

`legal-pages` hard-coded its public routes and boot-check-required blocks to the DACH set (`/legal/impressum`, `/legal/datenschutz`, `/legal/imprint`, `/legal/privacy`; required blocks `imprint/de` + `privacy/de`). An app with a non-German default language, or one that needs an additional page (e.g. a terms/AGB page), could not use the feature at all — the routes and the production boot check were both baked in.

`createLegalPagesFeature` now accepts optional `routes` and `requiredBlocks` options that default to the existing DACH constants, so current callers are unaffected. Routes are validated once at feature-build time (no duplicate `path`, no empty `path`/`slug`/`lang`, every `path` starts with `/`) so a misconfiguration fails app startup instead of a confusing 404 later. `LegalPageRoute`/`LegalRequiredBlock` types are exported for apps that want to type their own lists.
