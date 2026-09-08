---
"@cosmicdrift/kumiko-bundled-features": patch
---

Audit log detail, job run detail, personal access tokens, and MFA enable screens no longer hardcode `maxWidth="3xl"` on `FormScreenShell`. They now follow the app-wide `createKumikoApp({ screenWidth })` default like every other bundled screen instead of overriding it.
