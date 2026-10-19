---
status: in-progress
verified: 2026-06-21
issue: kumiko-framework#497
next: Implementierung + alle Tests grün (2026-06-21). Offen: Release (changeset liegt) + Daten-Migration pro Install + #497 schließen
---

# ES: Deterministische Stream-Platzierung für systemScope-Aggregate (#497)

**Sprint-Trigger:** 2026-06-21. Bei #497 (user-Events sollen auf `SYSTEM_TENANT_ID` statt verstreut auf `user.tenantId`) hat ein erster Anlauf eine **strukturelle Lücke im ES-Tenant-Stream-Modell** freigelegt. Drei Quick-Fix-Ansätze sind empirisch widerlegt — der echte Fix ist ein geplanter Sprint mit Migration.

## Implementierung (2026-06-21) — viel schmaler als ursprünglich gedacht

Das P1-Audit hat die Annahme „8 Features betroffen" widerlegt: **nur die `user`-Entity** hat das Scatter-Problem. Alles andere ist schon deterministisch — `jobs`/`feature-toggles` schreiben explizit auf `SYSTEM_TENANT_ID`, `tenant-membership`/`tenant-invitation`/`notification-preference` sind echt tenant-owned (sollen so bleiben), `config-value` wählt pro Write schon korrekt, `tenant` ist sui generis (aggregate_id = eigene Tenant-Id). `session` läuft über `r.unmanagedTable` (kein Executor).

**Gebauter Fix (surgisch, per-Entity opt-in):**
1. `EntityDefinition.systemStream?: boolean` + `createEntity({ systemStream })` (`engine/types/fields.ts`, `engine/factories.ts`).
2. Executor-Choke-Point `streamTenantFor(user) = entity.systemStream ? SYSTEM_TENANT_ID : user.tenantId`, durch alle ~13 Stream-Adressierungs-Stellen (append/getStreamVersion/assertStreamWritable, create+update+delete+restore) geroutet — **nicht** create-only, weil der generische CRUD-Update-Handler den Stream-Tenant NICHT upstream auflöst (`db.mode` war der falsche Weg: Feature-Scope ≠ Entity-Scope). Cache-Key + Search bleiben auf `user.tenantId`.
3. `user`-Entity setzt `systemStream: true` (`bundled-features/src/user/schema/user.ts`).

**Warum nur `user`-Flag = sicher:** `entity.systemStream` ist opt-in pro Entity, nicht vom Feature geerbt → membership/invitation/etc. unberührt. Für non-systemStream-Entities ist `streamTenantFor` byte-identisch zum alten `user.tenantId`.

**Tests (alle grün):** 256 Auth/sessions/user/tenant-Integration (5 sysadmin-pattern-Assertions auf `SYSTEM_TENANT_ID` aktualisiert, `.not.toBe(membershipTenant)` bleibt = Kern-Sicherheitsaussage), 114 + 691 Framework-Integration (keine Regression bei non-systemStream), neuer Guard-Test `db/__tests__/event-store-system-stream.integration.test.ts` (3/3) pinnt: systemStream→SYSTEM jede Op, normal→Tenant. Changeset liegt (`systemstream-stream-determinism.md`, beide Pakete minor).

**Offen:** Release + Daten-Migration (siehe unten) pro Install + #497 schließen. Workaround `getAggregateStreamTenant` BLEIBT (für un-migrierte Streams; Entfernen erst nach Migrations-Fenster aller Consumer = separater Schritt).

## Problem

Der Event-Store keyt Streams nach `(tenant_id, aggregate_id)` (Unique-Index `events_aggregate_version_uq`). Das passt für tenant-scoped Aggregate. Aber:

- **systemScope-Aggregate sind nicht tenant-gebunden.** Ein User gehört zu N Tenants. „Welcher `tenant_id` keyt seinen Stream?" hat keine saubere Antwort → der Stream landet auf dem **Signup-Zeit-Tenant** (arbiträr) und liegt fortan dort verstreut.
- **Der Context-Tenant ist immer da, aber der falsche Key.** Festgelegt ist: jede User-Aktion trägt einen expliziten aktiven Tenant (`SessionUser.tenantId`); das Tenant-Feature erzwingt das. Für ein systemScope-Aggregat ist dieser Context-Tenant aber nur „wo agiert der User gerade", nicht „wem gehört dieser Stream". Ausnahme bestätigt die Regel: Auth-Bootstrap (login/signup/reset/token-verify) läuft über `createSystemUser(SYSTEM_TENANT_ID)` — vor/quer zur Tenant-Wahl.
- **Der Workaround IST das Symptom.** `getAggregateStreamTenant` + `orderTenantsByPreference` (`bundled-features/src/auth-email-password/stream-tenant.ts` + Caller `change-password.write.ts:44`, `confirm-token-flow.ts:160-173`) existieren nur, um verstreute Streams wiederzufinden. Funktioniert, ist aber fragile, nicht-offensichtliche Schuld: jeder neue Handler, der ein systemScope-Aggregat schreibt, muss den Stream-Tenant korrekt selbst auflösen.

## Wurzel: `r.systemScope()` ist feature-weit, zu grob

`r.systemScope()` schaltet das **ganze Feature** in system-mode (`TenantDb.mode`, `tenant-db.ts:25`). Aber ein systemScope-Feature besitzt oft **gemischt-scopte** Entities:

- `tenant`-Feature ist systemScope und besitzt `invitation` / `membership` — die sind **echt tenant-owned** (eine Invitation gehört zu Tenant X).
- Die Handler kompensieren das manuell: `createSystemUser(invitationTenantId)` re-injiziert den Tenant pro Write.

Das richtige Signal ist **per-Entity** („ist dieses Aggregat identity/system oder tenant-owned?"), nicht per-Feature. 8+ bundled-features tragen `r.systemScope()` (tenant, user, config, secrets, jobs, delivery, feature-toggles, step-dispatcher) — die brauchen eine feinere Scope-Achse.

## Drei widerlegte Ansätze (NICHT wiederholen)

| Ansatz | Idee | Ergebnis |
|---|---|---|
| Naiv | alle `user.tenantId` → `SYSTEM_TENANT_ID` im Executor | bricht updates bestehender Streams (version_conflict) |
| **db.mode** | Executor liest `db.mode === "system"` | **12 Test-Fails** — db.mode = Feature-Scope, zwingt tenant-scoped invitation auf SYSTEM (cross-feature: systemScope-Feature schreibt tenant-Aggregat) |
| **entity-flag (feature-stamp)** | `entity.systemScope` bei feature-build stempeln, create-only routen | **19 Test-Fails** — Stamp markiert ALLE Entities eines systemScope-Features, inkl. tenant-owned invitation/membership → deren Creates wandern auf SYSTEM → `alreadyMember` false statt true |

Kern-Learning: **es gibt kein Single-Rule-Choke-Point**, weil das Design die Stream-Tenant-Entscheidung bewusst über die Handler verteilt (`createSystemUser(X)` je nach Aggregat).

## Viabler Ansatz: per-Entity-Stream-Scope, entkoppelt vom Feature

Eine **per-Entity-Scope-Achse** einführen, die NICHT vom Feature geerbt wird: jedes Aggregat deklariert (oder das Framework leitet ab), ob sein Stream `system` (identity, tenant-unabhängig: user, session) oder `tenant` (invitation, membership, Business-Daten) ist. Der Executor routet den **Create** (= das erste Event, das den Stream-Ort festlegt) nach dieser Achse; Updates/Deletes folgen dem bestehenden upstream-aufgelösten `writer.tenantId`.

## Phasen (bounded, sequenziell)

- **P1 — Audit + Scope-Achse.** Pro systemScope-Feature: welche Entities sind identity/system (user, session) vs. tenant-owned (invitation, membership, …)? Per-Entity-Scope-Deklaration entwerfen (entkoppelt von feature-level `r.systemScope()`). Boot-Validator-Regel: tenant-owned Entity unter systemScope-Feature muss explizit als tenant-scoped markiert sein.
- **P2 — Create-Routing.** Executor-create routet den ersten Append nach der Entity-Scope-Achse (`system` → `SYSTEM_TENANT_ID`). Update/Delete/Restore unverändert (respektieren handler-aufgelösten `writer.tenantId`). Read-Version-Checks (`detail`-getStreamVersion) prüfen: für un-migrierte system-Aggregate noch via Workaround.
- **P3 — Handler-Sweep.** Jede `createSystemUser(X)`-Stelle in auth/tenant prüfen: User-Creates auf SYSTEM, Invitation-Creates bleiben tenant. Sicherstellen, dass keine doppelte Entscheidung mehr nötig ist.
- **P4 — Test-Reconciliation.** Die ~12–19 Auth-Tests auf das neue deterministische Placement umschreiben; neue Tests pinnen per-Entity-Placement (system→SYSTEM, tenant→context). Sysadmin-pattern-Tests, die einen verstreuten Stream brauchen, konstruieren ihn explizit (raw insert), um den Workaround weiter zu testen.
- **P5 — Migration + Rollout.** Backfill: bestehende system-Aggregat-Streams auf `SYSTEM_TENANT_ID` verschieben (`UPDATE kumiko_events` + `rebuildProjection`; Unique-Index-Konflikt prüfen). Pro Consumer-Install einmal. Marcs 3 Installs (<100 Events) trivial/manuell.
- **P6 (später, separat) — Workaround entfernen.** `getAggregateStreamTenant`/`orderTenantsByPreference` erst nach abgeschlossenem Migrations-Fenster aller Consumer raus (Entfernen ist breaking für un-migrierte Streams).

## Risiken / offene Entscheidungen

- **Welche Entities sind system vs. tenant?** Kern-Audit von P1. Falsch klassifiziert = genau die 12/19-Fails.
- **Migration irreversibel** (mutiert append-only Log). Pro Install ein Wartungsfenster; Sequencing: erst Daten moven, dann Code deployen (sonst sind Alt-Events kurz unsichtbar).
- **Consumer-Rollout** ist Zwei-Schritt (wie bei früheren breaking changes): Code, das auf SYSTEM liest, darf erst nach der Migration live.
- **Workaround bleibt** bis alle migriert sind — kein Big-Bang.

## Definition of Done

Per-Entity-Scope-Achse live; Executor-create routet deterministisch; alle Auth-Tests grün + neue Placement-Tests; Migrations-Script vorhanden; Marcs 3 Installs migriert; #497 geschlossen mit Beleg; dieses Doc → `status: shipped` + nach `docs/archive/plans/`.

## Aufwand

Echter Sprint (mehrtägig), kein One-Shot. Der Code-Kern ist klein; der Aufwand liegt in P1 (Audit) + P4 (12–19 Tests korrekt reconcilen) + P5 (Migration/Rollout).
