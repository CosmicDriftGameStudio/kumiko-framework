---
"@cosmicdrift/kumiko-guards": minor
---

guard-fake-tests now also runs in app repos, counts same-file assertion helpers and the writeOk/writeErr/queryOk/queryErr test APIs as assertions; skip output distinguishes "outside guard kinds" from "target repos missing".

<!-- kumiko-changes
feature: guards
type: improvement
title: guard-fake-tests now also runs in app repos, counts same-file assertion helpers and the writeOk/writeErr/queryOk/queryErr test APIs as assertions; skip output distinguishes "outside guard kinds" from "target repos missing"
migration: |
  A same-file helper function (or arrow/function-expression variable) whose
  body calls `expect(...)` — directly or through up to two more levels of
  same-file helpers — now counts as an assertion, same as calling `expect`
  in the test body itself. `stack.http.writeOk/writeErr` and
  `tenant.api.queryOk/queryErr` (matched on the last property name of the
  callee) count as assertions too, since they throw on the wrong outcome.
  A bare Testing Library `waitFor(() => screen.getByTestId(...))` (or any
  other `getBy*`/`getAllBy*` query call) does NOT count as an assertion —
  it still needs its own `expect(...)` to prove the wait actually found
  something. The guard now also scans `kind: "app"` repos and `.tsx` test files,
  not just framework/library `.ts`. `reportResults` now prints "skipped,
  repo kind outside guard kinds (<kinds>)" instead of "target repos not in
  checkout" when the checkout has repo roots but none match the guard's
  `kinds` — the missing-checkout case keeps its original message.
-->
