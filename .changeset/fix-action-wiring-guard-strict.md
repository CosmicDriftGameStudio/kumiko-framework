---
"@cosmicdrift/kumiko-framework": patch
---

`kumiko check`: the Action-Wiring guard step now runs with `--strict`. Without
the flag the guard's `process.exit(1)` stays behind `if (strict)`, so violations
were only printed to stderr and the step exited 0 — an invoked but never-failing
no-op that could not gate the pipeline. Every other guard step already fails by
exit code; this was the sole outlier. Verified safe: the guard currently scans
154 files across the consuming repos with zero violations, so enabling the gate
does not retroactively break the build.
