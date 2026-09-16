---
"@cosmicdrift/kumiko-guards": minor
---

Migrate the remaining framework-semantic guards out of the private infra/guards package: complexity, predicate-extraction, i18n-UI-strings, screen-conventions and write-handler-QN guards are now registered in the shared runners as-is, and the as-casts, secret-literal, loadAllEventsByType and table-DDL checks are rebuilt on the public AstGuard/RepoCheck architecture (roots passed as a parameter instead of resolved from a module-global, no more standalone `main()`). The private `@cosmicdriftgamestudio/kumiko-guards` dependency is no longer required by the framework.

<!-- kumiko-changes
feature: guards
type: feature
title: Migrate remaining framework-semantic guards out of infra/guards
-->
