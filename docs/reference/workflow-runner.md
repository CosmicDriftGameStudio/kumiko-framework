---
status: reference
verified: 2026-09-04
evidence: "kumiko-framework#2482 (workflow-runner Run-Envelope als bundled Feature); kumiko-framework#2513 (Resume-Loop, Phase 1+2); engine/define-workflow.ts; bundled-features/workflow-runner"
---

# Workflow-Runner: Run-Envelope für Biz-Workflows

`workflow-runner` ist ein **bundled Feature** (fw#2482), das die
`defineWorkflow`-Engine-API mit einer lauffähigen **Run-Envelope** verbindet:
anstatt lose gekoppelter Handler bekommt eine Workflow-Instanz eine klare
Run-ID, ein Lebenszyklus und persistierte Run-Events. Liegt unter
`packages/bundled-features/src/workflow-runner/`.

## Definition (`defineWorkflow`)

Die Engine-API `defineWorkflow` (aus `@cosmicdrift/kumiko-framework/engine`,
`define-workflow.ts`) beschreibt einen Workflow deklarativ:

- **`trigger`** — z. B. `{ kind: "event", eventType: "user.signed-up" }` als
  Startbedingung.
- **`steps`** — `stepsPipeline(({ event, r }) => [...])` mit `r.step.*`
  (mail.send, wait, read.findOne, branch, retry, webhook.send, …).

`WorkflowDefinition<TPayload, TData>` und `WorkflowInput` sind die
zugehörigen Typen (exportiert über `engine/index.ts`).

## Run-Envelope (`runner.ts`)

`startAndRunWorkflow({ runId, ... })` schlägt die Laufzeit-Hülle um eine
Pipeline:

1. **`workflow.run-started`** wird mit dem Q7-Snapshot-Fingerprint appended.
2. Die Pipeline läuft. Ein `wait`/`retry`/`waitForEvent`-Suspend gibt still
   `{outcome: "suspended"}` zurück — der Resume-Loop (fw#2513 Phase 2+3b)
   holt die Run automatisch wieder ab.
3. Bei Abschluss wird **`workflow.run-completed`** appended — entweder im
   selben Pass oder, nach einem Resume, im Pass, der die Run tatsächlich zu
   Ende bringt. Fehler der Pipeline propagieren zum `event-trigger`, der
   **`workflow.run-failed`** aufzeichnet.

### Resume-Loop (fw#2513 Phase 2)

Suspendierte `wait`/`retry`-Steps landen über `pending-projection.ts` in der
`workflow_run_pending`-Tabelle. Der Cron-Job `resume-due-runs`
(`perTenant`, minütlich) selektiert fällige Zeilen (`wakeAt < now()`) und
dispatcht pro Zeile `workflow-runner:write:resume-run` — der Job selbst
macht nichts außer Selektieren + Dispatchen. Der Command-Handler
`resume-run` (`r.systemScope()`, `SYSTEM_ROLE`-only) macht den
Q7-Fingerprint-Check, claimt die Run per `WORKFLOW_RESUMED`-Event und setzt
die Pipeline via `runStepList(..., resumeFrom)` fort. Eine geänderte
Workflow-Definition (Q7-Mismatch) führt zu `workflow.run-failed` mit
`reason: "workflow_definition_changed"` statt eines stillen Skips.

### Event-Wakeup (fw#2513 Phase 3b, D4)

Ein Workflow deklariert die Events, auf die seine `waitForEvent`-Steps warten
können, in `defineWorkflow({ awaits: { ... } })` — das ist die einzige Quelle,
über die `r.step.waitForEvent({ event: awaits.foo, ... })` einen Event-Typ
erreichen kann (branded `AwaitedEventType`, kein roher String). Für jeden
Workflow mit einer nicht-leeren `awaits`-Deklaration registriert
`registerEventTrigger` eine eigene, aus dieser Deklaration gebaute
MultiStreamProjection (`event-subscriber.ts`) — eine pro Workflow, nicht eine
geteilte über alle Workflows hinweg, weil `r.multiStreamProjection` bei einer
leeren `apply`-Map sofort wirft und ein geteiltes MSP von der Import-Reihenfolge
der App abhinge.

Trifft ein passendes Event ein, lädt der Subscriber die pending Zeilen des
Tenants mit demselben `waitEventType`, wertet ein gesetztes `matchExpr` per
`evaluateEventMatch` aus und setzt bei Treffer `triggerEventType` +
`triggerEventRef` (eventId, aggregateId, version des awaited Events, keine
Payload-Kopie) + `wakeAt = now()` auf die Zeile — der bestehende
`resume-due-runs`-Job holt sie beim nächsten Tick ab, genau wie beim
Timeout-Pfad. Der Subscriber resumt nie selbst (D3: sein Apply-Context hat
kein `callFeature`/`runStepList`). `resume-run` lädt das awaited Event per
`ctx.loadAggregate` und seedet dessen Payload als Ergebnis des übersprungenen
`waitForEvent`-Steps (`ctx.steps[awaits.foo]`), damit ein nachfolgender Step per
Resolver darauf zugreifen kann. Ist das Event nicht mehr ladbar, endet der Run
mit `workflow.run-failed` und `reason: "awaited_event_unavailable"`; bei einem
Timeout ohne Treffer bleibt das Ergebnis `undefined`.

## Trigger-Event als Referenz

Der `workflow-run`-Stream speichert keine Kopie fremder Event-Payloads.
`workflow.run-started` trägt `triggerEventType` und
`triggerEventRef: { eventId, aggregateId, version }`; `resume-run` lädt das
Trigger-Event beim Resume aus dem Event-Store. Wurde das Quell-Event
geschreddert (Crypto-Shredding), sieht der Step die geschredderte Fassung. Ist
es nicht mehr ladbar (z. B. archivierter Stream), endet der Run mit
`workflow.run-failed` und `reason: "trigger_event_unavailable"`. Vor dieser
Änderung gestartete Runs behalten ihre alte Payload-Kopie und werden daraus
weiter resumed.

## Aggregat-Instanz (`aggregate-id.ts`)

`workflowRunAggregateId(workflowName, key)` baut die deterministische
Aggregat-ID einer Run — pro `workflowName` + Key genau eine Instanz.

## Event-Trigger (`event-trigger.ts`)

`registerEventTrigger(r, workflowDefinition)` hängt einen Start-Trigger an ein
Domain-/System-Event und startet die Run-Envelope darüber.

## Einsatzregel

Für reine Einweg-Verarbeitung ohne Run-Lebenszyklus genügt `r.job(...)`
(Audit-Trail `read_job_runs`, siehe `kumiko-bundled-features`-Feature-Index
`jobs`). Erst wenn eine **Workflow-Instanz** mit Run-Status, Aggregat-ID und
`run-started/completed/failed`-Events gemeint ist, kommt `workflow-runner` /
die Workflow-Engine zum Zug.
