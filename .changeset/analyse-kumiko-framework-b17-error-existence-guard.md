---
"@cosmicdrift/kumiko-guards": patch
---

The fake-test guard flags existence-only checks on writeErr and queryErr results.

<!-- kumiko-changes
feature: guards
type: improvement
title: Fake-Test Guard flags existence-only checks on error results
detail: `writeErr` and `queryErr` always return an error object (or throw when the call succeeded), so `expect(error).toBeDefined()`, `.toBeTruthy()`, `.not.toBeNull()` or `.not.toBeUndefined()` on that result, or on its `code`, `httpStatus`, `message` or `i18nKey`, proves nothing. The guard now reports these as "ERROR EXISTS ONLY". The value is resolved through its declaration, so a same-named variable from another call is not affected.
migration: Replace the existence check with the expected error, e.g. `expect(error).toMatchObject({ code: "validation_error" })` or `expect(error.code).toBe("access_denied")`.
-->
