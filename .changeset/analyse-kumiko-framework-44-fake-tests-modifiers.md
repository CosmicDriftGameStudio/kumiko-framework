---
"@cosmicdrift/kumiko-guards": patch
---

The fake-test guard also checks test.each, it.concurrent and other test modifiers, and flags a value compared with itself.

<!-- kumiko-changes
feature: guards
type: improvement
title: Fake-Test Guard covers test modifiers and self comparisons
detail: A test declared through `test.each(...)(...)`, `it.concurrent`, `test.skip`, `test.if(...)(...)` or a renamed `bun:test` import now needs an assertion like a plain `test`/`it`. `expect(x).toBe(x)`, `toEqual` and `toStrictEqual` with the same argument on both sides count as a tautology when the argument contains no call, so determinism checks such as `expect(hash(a)).toBe(hash(a))` stay allowed.
-->
