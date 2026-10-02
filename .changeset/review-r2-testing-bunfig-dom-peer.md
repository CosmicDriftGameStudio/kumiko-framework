---
"@cosmicdrift/kumiko-testing": patch
---

`kumiko-testing bunfig` drops ignore patterns the template owns but omits for the variant (such as `**/*.test.tsx` in a DOM bunfig) instead of keeping them as app extras, which silently skipped the whole suite. `@testing-library/dom` is declared as an optional peer dependency, since `@testing-library/react` needs it for `preload/dom`; apps using `--dom` install it alongside `@testing-library/react`.

<!-- kumiko-changes
feature: testing
type: fix
title: bunfig merge drops stale template-owned ignore patterns; @testing-library/dom declared as optional peer
-->
