---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-testing": minor
---

runSeedWritesAt: regular writes with a caller-set event time for E2E and demo seeds

`runSeedWritesAt(createdAt, fn)` from `@cosmicdrift/kumiko-framework/event-store` runs `fn` so that every event appended inside it is stored with `createdAt` instead of the database `now()`. The writes still go through the normal path (handler, validation, event append, projections), so projections that read the event time, such as entity `insertedAt`/`modifiedAt`, see the back-dated value. The helper only works with `KUMIKO_TEST_SEED=1` and `NODE_ENV` other than `production`; otherwise it throws `SeedModeDisabledError` before `fn` runs. `buildServer` now refuses to boot when `KUMIKO_TEST_SEED=1` is set together with `NODE_ENV=production`. Nothing from a request (payload, headers, seed-route body) can set the time; call the helper from an in-process seeder such as an `extraSeeders` entry or a `runDevApp` seed function. Events keep their global id order, so back-dated events are still delivered to consumers; only `created_at` order differs. Write the events of one stream in ascending time, because projection rebuilds replay by `(created_at, id)`.

<!-- kumiko-changes
feature: event-store
type: feature
title: runSeedWritesAt runs regular writes with a caller-set event time, only in seed mode
migration: |
  Seeders that need history (for example 90 days of status changes) wrap their dispatcher or ctx.write calls in `runSeedWritesAt(createdAt, async () => { ... })` instead of writing events or projection rows directly. Boot the server with `KUMIKO_TEST_SEED=1` and a non-production `NODE_ENV`; a boot with both the flag and `NODE_ENV=production` now fails. Within one aggregate stream, write the events in ascending time.
-->
