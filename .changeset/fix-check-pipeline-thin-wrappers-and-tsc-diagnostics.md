---
"@cosmicdrift/kumiko-framework": patch
---

Two `kumiko check` pipeline fixes from review:

- The `kumiko-guard-thin-wrappers` guard was published as a bin but wired into
  no pipeline step, so it never ran (silent coverage gap). It now runs as a
  warning-only step (exit 0, non-gating) in the check pipeline, matching the
  behaviour the docs describe. It cannot join the shared AST-guard runner — it
  builds its own ts-morph project and exports no `AstGuard`.
- `check-app-tsc` printed a misleading "0 error(s) across 0 workspace(s)" and
  exited 1 when `tsc -b` failed without producing a line matching
  `error TSxxxx:` (a spawn failure, a config-load error, or a `TS6053`-style
  message) — CI red with no visible cause. It now surfaces the raw tsc output,
  spawn error and exit status instead (`describeUnparseableTscFailure`).
