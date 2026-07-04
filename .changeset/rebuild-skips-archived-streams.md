---
"@cosmicdrift/kumiko-framework": minor
---

Projection rebuilds no longer replay events of archived streams (Marten-aligned).
`archiveStream` thereby becomes the documented healing tool for stranded
aggregates from historical eventless read-side writes: archive the aggregate
whose live row is gone and the rebuild stops resurrecting it or colliding on
unique indexes (fw#832). The #443 ground-truth count applies the same filter.
