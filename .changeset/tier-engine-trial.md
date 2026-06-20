---
"@cosmicdrift/kumiko-bundled-features": minor
---

tier-engine: optionale Trial-Phase. `createTierEngineFeature({ trial: { tier, durationHours } })` schaltet jedem Tenant für `durationHours` ab seinem Anlage-Datum (`inserted_at` der tier-assignment-Row, rebuild-stabil aus dem Create-Event) zusätzlich die Features von `trial.tier` frei — danach fällt er automatisch auf sein gespeichertes Tier zurück. Rein zeit-abgeleitet (at-resolve-time im tenantTierResolver berechnet, nie gecacht): kein Stored-Flag, kein Scheduler, automatischer Ablauf. Ohne `trial`-Option ist der Resolver byte-identisch zu vorher. Neuer Export `isTrialActive` + Typ `TrialPolicy`.
