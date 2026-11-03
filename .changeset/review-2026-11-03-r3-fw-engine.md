---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Review round 3 engine fixes: workflow wake times follow the database clock, an explicit search configure() survives a wider later default, and the per-tenant job cap holds under concurrent dispatch.

<!-- kumiko-changes
feature: framework
type: fix
title: workflow wait, waitForEvent and retry compute their wake time from the database clock
detail: `r.step.wait`, `r.step.waitForEvent` and `r.step.retry` took the wake time from the app clock while the resume scan compares it with Postgres `now()`, so a job host running ahead woke retries and waits late and one running behind fired `waitForEvent` timeouts early. The steps now read the database clock, in the trigger projection and in `resume-run` alike. `queryDatabaseNow` is exported from `@cosmicdrift/kumiko-framework/db` for that.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: an explicit Meilisearch configure() is no longer widened by a later default
detail: `configure()` now leaves an `_explicitConfig` marker in the index's filterable attributes. Before, an explicit configuration narrowed to a subset of the registry default could not be told apart from an older default and was widened again after the next restart. Indexes configured explicitly before this change carry no marker and keep the old behavior.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: maxPerTenant skip cap holds under concurrent dispatch
detail: `dispatch` and `handleEvent` for a job with `maxPerTenant` and `onLimit: "skip"` now hold a short Redis lock per job and tenant across the count and the enqueue, so simultaneous dispatches from api and worker processes can no longer all pass at `limit - 1`. A lock that stays contended for three seconds degrades to the earlier soft cap with a warning.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: server wiring and middleware split into smaller files; event payload scrub documents its maintenance window
detail: Rate-limit wiring and the PAT rate-limit guard moved out of `server-wiring.ts` and `server-middleware.ts` without behavior change. `scrubEventPayloadFields` must run in a maintenance window, because batches page by id over committed rows and an event that commits below the cursor during the run is not scrubbed.
-->
