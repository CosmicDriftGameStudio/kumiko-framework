---
"@cosmicdrift/kumiko-guards": minor
---

test-timeouts guard flags timeout arguments on test(), it() and describe()

<!-- kumiko-changes
feature: guards
type: breaking
title: test-timeouts guard flags timeout arguments on test(), it() and describe()
migration: |
  Remove the timeout argument from test/it/describe calls (test(name, fn, 30_000), test(name, fn, { timeout }), also via .skip/.only/.if()/.each()) and fix the cause: poll with waitFor/expect.poll, shrink the data set, share expensive setup in beforeAll. setDefaultTimeout and describe.configure through renamed or namespace bun:test imports are flagged too. A justified remainder gets '// @timeout-exception: #<issue> <reason>' on the line above the call.
-->
