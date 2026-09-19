---
status: reference
verified: 2026-09-19
evidence: "kumiko-framework#3052; observability/standard-metrics.ts, jobs/job-runner.ts"
---

# Job-Liveness: `kumiko_job_last_success_timestamp_seconds`

Standard-Gauge, die der Job-Runner nach jedem erfolgreichen Lauf eines über
`r.job` registrierten Jobs setzt. Label `job` trägt den Job-QN aus der
Registrierung (z. B. `user-data-rights:job:run-export-jobs`); der Wert ist der
Unix-Zeitstempel des letzten Erfolgs in Sekunden.

Damit bekommt jeder Consumer einen echten Dead-Man für seine Crons. Die
k8s-CronJob-Alerts greifen für Kumiko-Jobs nicht, weil sie in-process im
langlebigen App-Pod laufen und kein CronJob-Objekt erzeugen.

## Semantik

- Gesetzt, sobald der Handler durchgelaufen ist — vor den Observer-Hooks, damit
  ein fehlschlagender `onJobComplete` keinen erfolgreichen Lauf als tot
  erscheinen lässt.
- Ein fehlgeschlagener Lauf aktualisiert den Wert **nicht**. Bei Retries zählt
  erst der Versuch, der durchläuft.
- Deckt alle Trigger ab (cron, event, manual, Boot-Gates) — es gibt nur einen
  Ausführungspfad im Runner.
- Braucht einen gesetzten `context.meter`. Ohne Meter (z. B. Noop-Setup) wird
  nichts emittiert.
- Der per-Tenant-Fan-out-Wrapper stempelt nicht; die einzelnen Kind-Jobs tun es
  unter demselben Job-Namen.

## Alerting: das `for:` muss den Neustart überleben

Die Serie existiert **nicht**, bis der Job nach einem Prozessstart das erste Mal
erfolgreich war — der Meter serialisiert nur belegte Slots. Nach einem Rollout
ist der Zeitstempel also für bis zu ein volles Job-Intervall abwesend, nicht
etwa alt.

Folge für die Alert-Regel:

```
time() - kumiko_job_last_success_timestamp_seconds{job="<qn>"} > <intervall + puffer>
for: <mindestens ein Job-Intervall>
```

Ein `absent()`-Companion auf diese Metrik ist nur sinnvoll, wenn sein `for:`
ebenfalls über einem Job-Intervall liegt; sonst feuert jeder Deploy.
