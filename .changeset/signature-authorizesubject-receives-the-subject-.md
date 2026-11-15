---
"@cosmicdrift/kumiko-bundled-features": minor
---

authorizeSubject receives the subject scope context instead of the full handler context

<!-- kumiko-changes
feature: signature
type: breaking
title: authorizeSubject receives the subject scope context instead of the full handler context
migration: |
  The ctx argument of `authorizeSubject` (`AuthorizeSignatureSubject`, `AuthorizeDocumentDraftSubject`) is now `SubjectScopeContext` from the shared barrel: `db`, `registry` and `services` only, because the check also runs in `beforeTransaction`, before a draft is printed. A callback that reads only these compiles unchanged; one that used `ctx.user`, `ctx.dispatch` or `ctx.events` takes the user from its second argument and reads through `ctx.db` instead.
-->
