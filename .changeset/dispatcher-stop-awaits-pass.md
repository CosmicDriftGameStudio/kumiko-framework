---
"@cosmicdrift/kumiko-framework": patch
---

event-dispatcher stop() waits for a pass still in its idle pre-check

<!-- kumiko-changes
feature: framework
type: fix
title: event-dispatcher stop() waits for a pass still in its idle pre-check
detail: |
  Since 0.308.0 a pass started by the timer or a NOTIFY wake-up shortly
  before stop() could still be inside its idle pre-check, which stop()
  never waited for. That pass kept running after stop() returned and
  queried the DB pool the caller was closing, which could make
  postgres.js' end() hang. stop() now also drains in-flight passes.
  No migration needed.
-->
