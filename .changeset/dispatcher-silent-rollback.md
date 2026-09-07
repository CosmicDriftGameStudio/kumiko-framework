---
"@cosmicdrift/kumiko-framework": patch
---

Event-dispatcher pass failures no longer vanish silently. A thrown error
inside a consumer's pass transaction used to roll back attempts/last_error
along with the rest of the tx, and `context.log?.error` swallowed the
message entirely when no logger was wired — a failing consumer could loop
indefinitely while `kumiko_event_consumers` looked perfectly healthy. Now
the failure falls back to `console.error`, gets recorded (best-effort) in
its own transaction so attempts/last_error survive the rollback, and the
consumer backs off exponentially (capped at 60s) instead of retrying every
poll tick.
