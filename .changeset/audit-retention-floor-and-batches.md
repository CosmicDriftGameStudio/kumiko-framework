---
"@cosmicdrift/kumiko-bundled-features": patch
---

Escape-hatch retention honours an operator-set retention key as a floor and prunes in batches

<!-- kumiko-changes
feature: audit
type: fix
title: Escape-hatch retention keeps the operator floor and deletes in bounded batches
detail: An explicitly configured retention key now acts as a lower bound for tenant compliance-profile cutoffs, so a tenant profile can no longer delete events younger than the operator allows. A key left at its default does not count. Pruning runs in batches of 5000 events, each in its own transaction, until a batch comes back short.
-->
