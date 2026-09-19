---
"@cosmicdrift/kumiko-framework": minor
---

Event-Attribution: metadata.feature + metadata.handler auf jedem Event

event-store.append() stempelt Feature und Handler-Namen aus dem Ausfuehrungsscope (requestContext) auf jedes geschriebene Event. Dispatch-Handler, Entity-Executor-Writes, MSP-Applies und Jobs sind damit ohne Signaturaenderung attribuiert; Appends ausserhalb eines Scopes tragen UNATTRIBUTED_ORIGIN. appendRaw/appendRawBatch bleiben unveraendert.

<!-- kumiko-changes
feature: framework
type: improvement
title: Event-Attribution: metadata.feature + metadata.handler auf jedem Event
-->
