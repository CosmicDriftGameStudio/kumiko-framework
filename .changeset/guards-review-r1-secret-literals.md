---
"@cosmicdrift/kumiko-guards": patch
---

Guard review fixes: the secret-literal check finds comments via the TypeScript parser (no more skipped code after regex or template literals), matches the secret name left of the fallback, also flags literals containing hmac/private-key/signing-key, supports `kumiko-lint-ignore secret-literal`, and no longer prints the literal; `loadSecurityBaseline` returns an invalid result instead of throwing on a bad repo name; plus smaller message, scope and URL-literal fixes in the loadAllEvents, escape-hatch and process-env guards.

<!-- kumiko-changes
feature: guards
type: improvement
title: secret-literal guard flags more fallbacks and no longer leaks literals
migration: |
  Neue Violations bei `*/ code`-Zeilen, Code-Zeilen mit fuehrendem `*` und Literalen mit hmac/private-key/signing-key; die Violation-Message nennt Name und Laenge statt der Zeile. Fallbacks entfernen und das Secret hart aus dem validierten Env lesen.
-->
