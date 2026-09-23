---
"@cosmicdrift/kumiko-guards": minor
---

Add `kumiko-pre-push` bin: a POSIX-sh port of the pre-push hook mechanics (parent-workspace scoping, worktree detection, standalone fallback, `scripts/pre-push-extra.sh` extension point), so consumer repos can wire a thin shim instead of vendoring the logic.
