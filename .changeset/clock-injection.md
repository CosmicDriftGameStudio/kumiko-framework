---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

One injectable Clock for ctx.tz in handlers and jobs

<!-- kumiko-changes
feature: framework
type: breaking
title: One injectable Clock for ctx.tz in handlers and jobs
detail: New type Clock and TzContextOptions.clock. AppContext.clock feeds ctx.tz.now() in handlers, and JobContext.tz gives jobs the same ctx.tz API (tenant timezone from tenant config, read once per job run, UTC fallback). The testing helper createManualClock(start) returns a clock with set and advance. The tenant-lifecycle job now reads time through ctx.tz.now().
migration: Code that builds a JobContext literal itself (boot seeds, test doubles) adds `tz: createTzContext()`.
-->
