---
"@cosmicdrift/kumiko-framework": patch
---

New ownership rule fromParent(field, entity): child rows inherit read and write access from their parent row.

<!-- kumiko-changes
feature: ownership
type: improvement
title: fromParent ownership rule
detail: access.read and access.write accept fromParent(field, entity). A role sees and writes the child rows whose reference field points at a parent row that role may read or write under the parent's access map, including on create and when the reference moves. Chains over several levels work. The boot validator requires a reference field of that entity pointing at exactly that parent entity; field-level access rejects the rule. Custom executor calls without parentVisibility deny the parent grant.
-->
