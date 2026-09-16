---
"@cosmicdrift/kumiko-guards": minor
---

Port the upgrade-state and runtime-isolation guards

guard-upgrade-state and check-runtime-isolation ported from the private infra/guards package into the public @cosmicdrift/kumiko-guards package, rebuilt onto the public RepoCheck pattern with single-repo root resolution. guard-app-dockerfile, guard-doc-status, check-licenses, and check-security stay in infra/guards as CDGS-specific house rules (private registry scope, CDGS doc taxonomy, and CDGS license/security exception files with no equivalent consumer-facing mechanism in the public package) — they were deliberately not ported, not forgotten.

<!-- kumiko-changes
feature: guards
type: improvement
title: Port the upgrade-state and runtime-isolation guards
-->
