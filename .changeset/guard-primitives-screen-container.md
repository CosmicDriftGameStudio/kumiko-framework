---
"@cosmicdrift/kumiko-guards": minor
---

Primitives-discipline guard flags hand-built screen containers and scans client/ folders

A className combining `mx-auto` with a `max-w-*` token now fails the guard and points to `<PageSection maxWidth>` (3xl/4xl/full); files under a `public/` segment are exempt because PublicShell is their container. Web code under a `client/` path segment (enterprise ai-foundation) is now scanned too.

<!-- kumiko-changes
feature: guards
type: improvement
title: Primitives-discipline guard flags hand-built mx-auto + max-w-* screen containers
migration: Replace the hand-rolled container with `<PageSection maxWidth="3xl|4xl|full">`; a deliberate exception (e.g. a narrow centered card) carries `// kumiko-lint-ignore primitives-discipline <reason>`. Web code under `client/` folders is now scanned as well.
-->
