---
"@cosmicdrift/kumiko-guards": patch
---

Coverage guards now see test files, the admin-API allowlist and primitives-discipline resolve repo roots correctly, and the real-provider isolation check covers chained scripts and workspace packages.

<!-- kumiko-changes
feature: guards
type: improvement
title: Coverage guards scan test files; admin-api, primitives-discipline and real-provider-isolation resolve roots and workspaces properly
migration: |
  Neue Violations moeglich: access-denied-test und tenant-escalation zaehlen jetzt auch *.integration.ts und Tests ausserhalb der sourceRoots als Coverage (Scope source+tests); primitives-discipline scannt alle flat-src-App-Roots; check-real-provider-isolation flaggt Scripts, die test:real/e2e:real aufrufen, und prueft alle Workspace-package.json. Betroffene Stellen fixen oder per Security-Baseline neu einfrieren.
-->
