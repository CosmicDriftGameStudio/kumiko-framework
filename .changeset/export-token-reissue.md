---
"@cosmicdrift/kumiko-bundled-features": patch
---

user-data-rights: export-download-token re-runs rotate the token in place on the
same aggregate (update) instead of creating a second aggregate for the same
jobId. A second `created` event without a `deleted` in between made every
projection rebuild collide on the `one_per_job` unique index (fw#832). Operator
recovery after a lost plain token is now just "flip the job back to pending" —
never delete the token row read-side.
