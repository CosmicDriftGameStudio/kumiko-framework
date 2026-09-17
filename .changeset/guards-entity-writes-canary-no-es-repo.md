---
"@cosmicdrift/kumiko-guards": patch
---

Fix false-positive BLOCK in the Direct-Entity-Writes Guard for repos with no event store

An empty `esTables` set had one meaning: the scan lost track of ES definitions while table-write code still exists, so the guard reported a misconfiguration canary and blocked (the guard is `security: true`, so this always failed CI). That conflated two different situations: a repo with no event store at all (e.g. `kumiko-platform`, an Astro docs/marketing site) also has an empty `esTables` set, but there is nothing to guard against there. The guard now checks whether any table write is present at all before treating an empty `esTables` set as a misconfiguration; a repo with no ES and no table writes is green, while a repo with table writes but no resolvable ES tables still blocks as before.

<!-- kumiko-changes
feature: guards
type: fix
title: Fix false-positive BLOCK in the Direct-Entity-Writes Guard for repos with no event store
-->
