---
status: reference
verified: 2026-08-30
evidence: "kumiko-framework#2482 (workflow-runner Run-Envelope als bundled Feature); engine/define-workflow.ts; bundled-features/workflow-runner"
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
2. Die Pipeline läuft; bei Suspend wirft sie (siehe Modul-Doc).
3. Bei Abschluss wird **`workflow.run-completed`** appended. Fehler der
   Pipeline propagieren zum `event-trigger`, der **`workflow.run-failed`**
   aufzeichnet.

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
