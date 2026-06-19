---
"@cosmicdrift/kumiko-framework": patch
---

Cover the untested `enqueueProjectionRebuild` branch where a `jobRunner` is
present but the `projection-rebuild` job is not registered (a caller that wired a
jobRunner but forgot to compose `createJobsFeature()`) (#391/2). The
`registry.getJob` capability guard must fall to the inline rebuild rather than
dispatch onto a runner whose queue has no handler for the job — a silent no-op
otherwise. The new test asserts `mode: "inline"`, that the projection is actually
rebuilt, and that `dispatch` is never called.
