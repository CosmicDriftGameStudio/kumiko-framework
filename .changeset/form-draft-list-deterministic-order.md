---
"@cosmicdrift/kumiko-bundled-features": patch
---

`form-draft`'s `list` query now sorts newest-first with a deterministic `id` tiebreaker, instead of leaving ties (two drafts saved in the same millisecond) to Postgres' undefined row order.
