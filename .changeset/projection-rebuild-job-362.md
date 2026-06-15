---
"@cosmicdrift/kumiko-framework": minor
---

projections: first-class single-run rebuild trigger (`enqueueProjectionRebuild` + built-in job)

Phase 3 of `projection-aware-migrations`. Adds a self-service way to rebuild one
projection — the remediation the #361 fail-loud path points at, plus a manual
rebuild trigger and a post-upcaster refill path that no schema-diff would catch.

- **`enqueueProjectionRebuild(projection, { db, registry, jobRunner? })`** (migrations):
  with a `jobRunner` and the rebuild job registered (jobs feature composed) it
  dispatches a tracked, retryable job (`read_job_runs` + `read_job_run_logs`,
  `jobs:write:retry`); without jobs it falls back to a synchronous inline
  `rebuildProjection` — today's behaviour, framework-pure. Capability detection
  is via `registry.getJob`, not `hasFeature` (deterministic, no toggle-runtime
  dependency). Returns a `{ mode: "dispatched" | "inline" }` discriminated union.
- **Built-in job `jobs:job:projection-rebuild`** registered by the `jobs`
  bundled-feature — available automatically whenever `jobs` is composed, no
  extra feature to opt into. Its worker calls `rebuildProjection`.
- **JobRunner** now injects its own `registry` into every job context, matching
  the `JobContext` contract (`registry: Registry`) — workers no longer depend on
  the app author duplicating the registry into `context`.

Proven by real-pg/real-redis integration tests: inline fallback (no jobs) and
end-to-end dispatch → BullMQ worker → projection refilled + run tracked.
