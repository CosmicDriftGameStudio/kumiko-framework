---
"@cosmicdrift/kumiko-guards": patch
---

Several guards resolve code more precisely: lib-test-coverage, test-stack-drift, direct-fetch, no-framed-extension-sections, thin-wrappers, and the PII and text-field scans no longer log from scan functions.

<!-- kumiko-changes
feature: guards
type: improvement
title: guards resolve aliased imports, literal values, tsx lib files and entityEdit slots precisely
migration: |
  Neue Violations moeglich: lib-test-coverage erfasst jetzt .tsx und tiefere lib-Ebenen und zaehlt Fixtures unter __tests__ ohne .test-Suffix nicht als Test; test-stack-drift loest Import-Aliase auf; direct-fetch wertet den Laufzeitwert des Literals aus; no-framed-extension-sections behandelt nur slots.header von entityEdit-Screens als Header. Betroffene Stellen mit Test, echtem Import oder Anpassung beheben.
-->
