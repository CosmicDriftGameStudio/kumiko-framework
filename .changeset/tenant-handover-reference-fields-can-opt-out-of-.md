---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Reference fields can opt out of the handover with handover: "stay"; boot depth limit and mover share one graph definition

ReferenceFieldDef gains handover: "stay". An entity that should NOT travel with its host but points at it through a plain reference no longer blocks the claim with entity_not_transferable when that reference field carries handover: "stay": the edge is not walked, its rows stay in the source tenant, and the reference crosses the tenant boundary after the handover. Without the opt-out the behaviour is unchanged (entity_not_transferable at claim time). Migration: an entity that should NOT travel with its host: mark the reference field handover: "stay" (removing transferable alone does not help once rows exist, the claim still fails). The framework now exports one adjacency definition (resolveEntityTransferAdjacency, reference and parentRef edges, non-transferable intermediate nodes included, handover: "stay" respected) that the boot validator's depth limit and the tenant-handover mover both use. Consequence: the boot-time MAX_TRANSFER_DEPTH check now also counts parentRef edges and chains running through non-transferable entities, as the mover always did; a graph that was deeper than 5 hops only through such nodes now fails the boot instead of the claim.

<!-- kumiko-changes
feature: tenant-handover
type: improvement
title: Reference fields can opt out of the handover with handover: "stay"; boot depth limit and mover share one graph definition
-->
