---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-framework": minor
---

`actionForm` screens can name the success-payload field their post-submit redirect navigates by: `redirect: { screen: "lease-detail", idFrom: "leaseId" }` (`ActionFormRedirect`, `@cosmicdrift/kumiko-types`). Until now the renderer always navigated with `data.id`, so an action that creates a child record (add a lease item, add a protocol section) could only land on the child — a redirect back into the parent's detail screen resolved the parent id to the child's and 404'd.

The alternative was to make the write-handler report the parent id as its own `id`, breaking the handler's contract for every other caller. The routing decision now sits on the screen, where it belongs, and handlers keep reporting what they actually wrote.

Backwards compatible: `redirect` still accepts the plain string, which keeps navigating by `data.id`. The boot-validator resolves the object form's `screen` exactly like the string form (short id or cross-feature QN) and rejects an empty `idFrom`. As before, the id is only appended when the target screen carries one (`entityEdit`, `projectionDetail`).
