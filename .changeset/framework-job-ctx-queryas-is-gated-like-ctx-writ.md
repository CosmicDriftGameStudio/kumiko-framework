---
"@cosmicdrift/kumiko-framework": minor
---

Job ctx.queryAs is gated like ctx.writeAs

<!-- kumiko-changes
feature: framework
type: breaking
title: Job ctx.queryAs is gated like ctx.writeAs
migration: |
  Jobs calling ctx.queryAs with createSystemUser(...) or any identity other than the job's own caller now fail with AccessDeniedError (system_identity_switch_denied / identity_switch_denied). Declare r.systemScope() on the job's feature or escapeHatch: { reason } on the job, the same grant ctx.writeAs already needs. The escape-hatch guard exempts jobs by name, so this surfaces only at runtime; grep your jobs for ctx.queryAs. Known consumer sites: offlot-app channel-text generate-texts.job, campaign-calendar sync, campaign-channel-foundation seed-starter-channels.
-->
