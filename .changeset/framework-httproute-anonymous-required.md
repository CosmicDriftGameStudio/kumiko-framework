---
"@cosmicdrift/kumiko-framework": minor
---

r.httpRoute's `anonymous` field is now required and controls the mount, not just docs (fw#2885)

HttpRouteDefinition.anonymous changes from an optional, purely-documentary boolean to a required one that drives buildServer's mount. `anonymous: true` stays public, unchanged. `anonymous: false` now mounts the route behind the same session-auth chain /api/* uses: no anonymous fallthrough (a request without a session gets 401, never a synthesized anonymous user), the same PAT rate-limit guard, origin-allowlist guard and double-submit CSRF guard as /api/*, in the same order (auth → PAT → origin → CSRF). The handler reads the caller via getUser(c). feature-ui-extensions' httpRoute() now throws at feature-setup time when `anonymous` is missing or not a boolean (catches JS callers without the TypeScript type). The feature-AST (patterns/render/patcher/extractor/pattern-library) mirrors the field as required; a source file parsed before this change (missing `anonymous`) reads as `anonymous: false` — the safe side — and round-trip rendering always emits the field explicitly.

<!-- kumiko-changes
feature: framework
type: breaking
title: r.httpRoute's `anonymous` field is now required and controls the mount, not just docs (fw#2885)
migration: |
  Every r.httpRoute({...}) call site must declare anonymous: true | false. Routes that were implicitly public (no field, or anonymous: true) keep working unchanged once anonymous: true is added explicitly — feature-ui-extensions now throws at boot for a route missing the field. Routes meant to require a session must set anonymous: false; a request without a session then gets 401 instead of running (there is no anonymous fallthrough on those routes any more), and a cookie-authenticated state-changing request needs the same X-CSRF-Token as /api/* or gets 403. Feature-AST round-trips: a saved feature file that predates this change parses `anonymous` as false (not true) — audit any httpRoute that was implicitly public and add `anonymous: true` before re-saving through the Designer/AI editor, or the next render will lock it behind the session-auth chain.
-->
