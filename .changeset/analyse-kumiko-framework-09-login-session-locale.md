---
"@cosmicdrift/kumiko-bundled-features": patch
---

Password login, MFA verify and the pre-auth MFA enrollment build the session through one helper, so a password login now checks the stored locale like the MFA paths do.

<!-- kumiko-changes
feature: auth-email-password
type: fix
title: Password login keeps only a valid, canonical locale in the session
detail: A plain password login copied the user's stored locale into the session and JWT without checking it. It now goes through the same check as MFA verify and the pre-auth MFA enrollment: an invalid locale tag is left out and a valid one is stored in canonical form (for example `de-de` becomes `de-DE`). All three paths share one session builder that also applies the auth-claims hooks. Which account statuses may start a new session is now one predicate, `isPrincipalBlockedForNewAuth` from `@cosmicdrift/kumiko-bundled-features/user` (restricted, deletion requested, deleted); each path refuses the same statuses as before.
-->
