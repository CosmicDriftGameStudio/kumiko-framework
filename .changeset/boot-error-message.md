---
"@cosmicdrift/kumiko-framework": patch
---

`KumikoBootError.message` now includes the per-var detail block (var name,
source feature, missing/invalid reason, suggestion) instead of just the
single-line header. Previously an uncaught throw — e.g. `bun run boot` on a
freshly-scaffolded app with an unset `JWT_SECRET` — printed only

```
KumikoBootError: Boot failed: 1 env-var problem
 errors: [ [Object ...] ],
```

with the actual culprit collapsed inside Bun's default object pretty-print.
Now the message itself carries the same body that `.format()` already
produced, so the user sees which var caused the failure without needing to
add a `catch`-block + manual `.format()` call.
