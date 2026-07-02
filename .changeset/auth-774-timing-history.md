---
"@cosmicdrift/kumiko-framework": patch
---

fix(auth): close two low-severity auth findings (#774)

- Login no longer short-circuits before the argon2 verify on unknown emails: a
  fixed dummy hash is verified on the miss path so response latency no longer
  reveals whether an email is registered (timing enumeration).
- Magic-link screens (reset, verify, signup-confirm, invite-accept) now scrub
  the `?token=` param from the URL via `history.replaceState` after reading it,
  so single-use tokens don't linger in browser history / Referer. New
  `useUrlToken` hook replaces the raw `parseUrlToken` read in those screens.
