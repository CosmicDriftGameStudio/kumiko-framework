---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-samples": patch
---

The security section of the generated token guide warns against tokens in apps, web pages and logs and says to revoke a leaked token at once.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: api-docs token guide covers client code, logs and leaks
detail: The security list in `tokens.md` now says never to keep a token in an app or web page or in a log, and to revoke a token at once if it may have leaked, in all five locales. Regenerate with `kumiko api-docs`; `--check` reports the changed `tokens.md` until then.
-->
