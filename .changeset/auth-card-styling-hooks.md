---
"@cosmicdrift/kumiko-bundled-features": minor
---

AuthCard takes className, headerClassName, titleClassName and bodyClassName

`AuthCard` renders the body wrapper (`p-6 pt-0 flex flex-col gap-4`) itself and accepts `className` (Card), `headerClassName`, `titleClassName` and `bodyClassName`, merged with tailwind-merge over the defaults. The auth-email-password and auth-mfa screens no longer carry their own body wrapper; the rendered DOM stays the same. The session bootstrap error screen keeps its former bottom padding through `bodyClassName`.

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: AuthCard styling hooks (className, headerClassName, titleClassName, bodyClassName)
-->
