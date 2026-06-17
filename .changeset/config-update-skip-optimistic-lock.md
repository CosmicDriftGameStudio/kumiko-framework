---
"@cosmicdrift/kumiko-bundled-features": patch
---

config: don't optimistic-lock config writes (fixes save after a version desync)

Saving an existing config value compared the *projection* row version against
the *event-stream* version. If those drifted — a migration or seed that wrote
the read-row outside the normal event flow, like the Stripe config cut-over —
every save version-conflicted forever (`errors.versionConflict` on the
Settings-Hub screen).

Config is single-writer operator state, not a collaboratively-edited
aggregate, so `set.write` now skips the optimistic lock and appends at the
real stream version. The save succeeds and the projection resyncs (self-heals
the drift). Covered by an integration test that corrupts the projection
version and asserts the save still round-trips.
