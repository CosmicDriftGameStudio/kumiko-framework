---
"@cosmicdrift/kumiko-guards": minor
---

The Fake-Test Guard rejects existence checks on Testing Library queries and counts bare queries as assertions; the new `weak-assertions` ratchet freezes tests that only assert existence.

<!-- kumiko-changes
feature: guards
type: breaking
title: Existence-only checks on queries fail, existence-only tests are ratcheted
detail: Testing Library `getBy*`, `getAllBy*`, `findBy*` and `findAllBy*` queries throw when nothing matches, so the Fake-Test Guard now reports `.toBeTruthy()`, `.toBeDefined()`, `.not.toBeNull()` and `.not.toBeUndefined()` directly on such a query (also awaited) as "QUERY EXISTS ONLY". Chained checks such as `expect(screen.getByTestId("x").querySelector("input")).toBeTruthy()` stay allowed. A bare query call now counts as an assertion, a `findBy*` call only when it is awaited or returned, so `screen.getByText("Saved");` alone is a complete test; `queryBy*` still does not count. The new guard `weak-assertions` counts tests whose only assertions are `expect(x).toBeDefined()` or `expect(x).toBeTruthy()` and freezes them per file in `.kumiko-weak-assertions-baseline.json`; a missing baseline counts as empty.
migration: Replace `expect(<query>).toBeTruthy()` and the other existence checks on a query with the bare query call (`screen.getByText("Saved");`, `await screen.findByText("Saved");`). Then run `kumiko-guards guards --write-baseline --guard="weak-assertions"` once and commit `.kumiko-weak-assertions-baseline.json`.
affects: kumiko-guards
-->
