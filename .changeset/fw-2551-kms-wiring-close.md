---
"@cosmicdrift/kumiko-framework": minor
---

fw#2551: `resolveKmsWiring` / `requireKmsWiring` now return a `close()` alongside the wiring, so the caller can release the subject-keys connection pool the adapter opened. Without it a short-lived process — an ops script, a one-shot job, a Kubernetes Job — printed its report and then hung until something killed it, because `PgKmsAdapter`'s own `postgres()` pool kept the event loop alive; the exit code then read as a timeout even though the work had succeeded. `close` sits on both branches of the union (a no-op on the plaintext fallback), so `finally { await wiring.close() }` needs no narrowing. Long-running servers are unaffected: they are supposed to hold that pool open and simply never call it.
