---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
---

Raise the hono peer range to ^4.13.1 so consumers no longer resolve 4.12.x builds affected by the JSX context-isolation, memo() and cx() advisories.
