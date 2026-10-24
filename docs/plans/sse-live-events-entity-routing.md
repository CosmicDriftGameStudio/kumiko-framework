---
status: in-progress
verified: 2026-08-13
issue: kumiko-framework#2012
next: kumiko-framework#2048 zuerst abarbeiten (/issue-ship), dann publicstatus#355
---

# SSE Live-Events: Wire-Swap auf Entity-Level statt Verb-Enumeration

Treiber: kumiko-framework#2012. Der Web-SSE-Client (`renderer-web/src/sse/live-events.ts`)
verdrahtet pro Entity einen `addEventListener` je Verb aus einer festen Liste
(`created`, `updated`, `deleted`, `restored`). Zwei Konsequenzen:

1. **Business-Verbs kommen nie an.** Ein Feature das einen eigenen Lifecycle-Event
   emittiert (z. B. `archived`), broadcastet ihn korrekt server-seitig, aber kein
   Client-Listener matcht — `useQuery({ live: true })` bleibt stale. Konkret in
   solon#113 beobachtet.
2. **`forgotten` fehlt.** Der Server kennt fünf Auto-Verbs (`created`, `updated`,
   `deleted`, `restored`, `forgotten` — `AutoVerb` in
   `packages/framework/src/db/apply-entity-event.ts:59`), der Client nur vier.
   Betrifft crypto-shredding / Right-to-Erasure-Flows.

## Zwei Fassungen dieses Docs — was sich geändert hat

**Erste Fassung:** reiner Wire-Swap (`event:`-Name von `entity.verb` auf `aggregateType`
ändern) — verworfen, weil ich `publicstatus/src/public/use-public-status.ts` übersehen
hatte: ein eigener, roher `EventSource`-Consumer außerhalb des Framework-Abstraktion, der
exakte Verb-Namen registriert. Ein Swap hätte den schweigend gebrochen.

**Zweite Fassung:** additives zweites Frame (altes Verb-Frame bleibt, neues
Entity-Frame kommt dazu) — verworfen nach genauerem Hinsehen: additiv ist nur dann
gerechtfertigt, wenn ein echter externer Consumer bestehen bleiben MUSS, der sich nicht
migrieren lässt. Das ist hier nicht der Fall — `publicstatus` ist ein Repo im selben
Bun-Workspace, kein Blocker für eine koordinierte Änderung. Additiv hätte den
Wire-Vertrag dauerhaft verdoppelt für ein Problem, das eine einmalige Migration löst.

**Diese (dritte, finale) Fassung: Swap, aber korrekt zu Ende gedacht** — inkl. der
`publicstatus`-Migration als zweites Issue, nicht als "Follow-up, kein Blocker"
weggeschoben. Grund für den Swap statt additiv, jetzt mit Beleg statt Annahme: geprüft,
worauf `publicstatus`s zwei Custom-Events (`incident-update-posted`,
`incident-resolved`) tatsächlich geschrieben werden —

```ts
// publicstatus/src/features/publicstatus/handlers/incident-post-update.write.ts:53
await ctx.events.append({
  aggregateId: event.payload.incidentId,
  aggregateType: "incident",
  type: PublicStatusEvents.IncidentUpdatePosted,
  ...
});
```

Identisch in `incident-resolve.write.ts:53`. Beide Custom-Events tragen also bereits
`aggregateType: "incident"` — genau wie die vier Entity-CRUD-Events. Damit lösen sich
publicstatus' komplette 9 `SSE_EVENTS`-Einträge
(`component.created/updated/deleted`, `incident.created`,
`publicstatus:event:incident-update-posted`, `publicstatus:event:incident-resolved`,
`maintenance.created/updated`, `branding.created/updated`) auf genau **vier**
`aggregateType`s auf: `component`, `incident`, `maintenance`, `branding`. Kein
Custom-Event ohne `aggregateType`, das additiv bleiben müsste. Der Swap ist vollständig.

## Scope

**In (zwei S-Issues, zwei Repos, harte Reihenfolge):**

1. **`kumiko-framework`** — Server broadcastet pro Entity-Event EIN Frame mit
   `event: <aggregateType>` statt `event: <entity>.<verb>`. Nicht-Entity-Events (kein
   `aggregateType` im Payload, z. B. `channel-in-app:event:delivered`) behalten ihren
   bisherigen `event: <type>`-Namen unverändert — kein Consumer davon betroffen. Client
   verdrahtet genau EINEN `addEventListener` pro Entity statt vier.
2. **`publicstatus`** — `use-public-status.ts`s `SSE_EVENTS`-Array (9 Verb-Namen) wird
   durch die 4 Aggregate-Namen ersetzt; `sse-events-coverage.test.ts` entsprechend
   angepasst (siehe Tests unten — die Coverage-Test-Prämisse "neuer Lifecycle-Schritt
   braucht neuen Listener-Eintrag" verschwindet strukturell durch den Fix).

**Out:**
- Schema-Exposure eines Verb-Katalogs pro Entity (im Issue #2012 genannte Alternative) —
  bräuchte eine neue Boot-Time-Verteilung des Verb-Registers zum Client (`r.defineEvent`
  ist aktuell reines Build-Time-AST-Pattern für Codegen, kein Runtime-Schema). Deutlich
  mehr bewegliche Teile für denselben Effekt. Verworfen.
- Transition-Mechanik (temporär beide Frames senden, dann altes abbauen) — hier bewusst
  NICHT gebaut, siehe Rollout-Risiko unten. Wurde erwogen, aber für eine
  Zwei-Repo-Same-Day-Koordination als unnötiger Mehraufwand bewertet.

## Rollout-Risiko (bewusst in Kauf genommen, nicht weggeplant)

`kumiko-framework` und `publicstatus` deployen unabhängig (`reference_app_ci_test_pr_only_deploy_independent`).
Wenn das Framework-PR vor dem publicstatus-PR deployed, sendet der Server neue
Frame-Namen, `use-public-status.ts` hört noch auf die alten — Live-Refresh auf der
Public-Status-Page ist für das Zeitfenster zwischen beiden Deploys tot. **Kein
Datenverlust, kein Fehlerzustand** — die Seite zeigt weiter den Stand vom letzten Fetch,
ein manueller Reload holt den aktuellen Stand. Mitigation: publicstatus-PR direkt im
Anschluss an den Framework-Merge mergen+deployen, nicht liegen lassen (siehe
`feedback_built_mechanics_must_be_installed` — Consumer-Update ist Teil der DoD, kein
späteres Aufräumen).

## Betroffene Dateien

`SseEvent.data` trägt bereits `aggregateType` (gesetzt in `system-hooks.ts:307-316`,
unverändert) — `sse-route.ts` liest das direkt aus dem schon vorhandenen Payload, per
kleinem TypeGuard an der IO-Grenze (kein Cast). Kein Type-Change an `SseEvent` nötig,
`sse-broker.ts` und `system-hooks.ts` bleiben unangetastet.

### Issue 1 — `kumiko-framework`

1. **`packages/framework/src/api/sse-route.ts`** — im `streamSSE`-Callback:
   ```ts
   function isEntityEventData(data: Record<string, unknown>): data is { aggregateType: string } {
     return typeof data.aggregateType === "string";
   }
   // ...
   (event) => {
     const wireEventName = isEntityEventData(event.data) ? event.data.aggregateType : event.type;
     stream.writeSSE({ event: wireEventName, data: JSON.stringify(event.data) });
   }
   ```
   Ersetzt den bisherigen unconditional `stream.writeSSE({ event: event.type, ... })` —
   kein zweites Frame, ein Frame mit bedingtem Namen.

2. **`packages/renderer-web/src/sse/live-events.ts`**:
   - `VERBS`-Konstante (L13) komplett entfernen.
   - `ensureListenersForEntity`: Verb-Loop raus, EIN `source.addEventListener(entityName,
     ...)` pro Entity, dedupliziert über ein `wiredEntities`-Set (ersetzt `wiredTypes`).
   - `handleEvent`: der `type`-Parameter (bisher der volle Wire-Name) wird für das
     Payload nicht mehr gebraucht, da `parsed.aggregateType` schon im Payload steckt —
     Parameter entfernen (sonst ungenutzt → biome-Fehler). `LiveEvent.type` wird auf
     `parsed.aggregateType` gesetzt.
   - Den bestehenden `sub.entityName === parsed.aggregateType`-Filter in `handleEvent`
     **entfernen** — mit Registrierung direkt auf `entityName` liefert der Browser nur
     noch matchende Frames aus, der JS-seitige Vergleich ist danach totes Doppel-Gate.

**Test-Harness-Lücke, explizit im Issue nennen:** `sse-route.test.ts`s
`createTrackingBroker` verwirft den `send`-Callback und jeder Test bricht den Stream
sofort ab (siehe bestehende Security-Tests, die nur Channel-Scoping prüfen, nie den
tatsächlich geschriebenen Frame-Namen). Ein Test der behauptet "Event mit
`aggregateType` erzeugt Frame `event: <aggregateType>`" braucht einen Broker-Mock der
den `send`-Callback festhält und den Response-Body liest — andere Test-Struktur als die
vorhandenen Tests, nicht einfach ein weiterer `it()`-Block. Sonst wird daraus ein reiner
Existenz-Test ohne echte Verhaltensprüfung.

### Issue 2 — `publicstatus` (depends on Issue 1, sequenziell nach dessen Merge+Deploy)

3. **`src/public/use-public-status.ts`** — `SSE_EVENTS`-Array (L31-51, 9 Einträge)
   ersetzen durch:
   ```ts
   const SSE_EVENTS = ["component", "incident", "maintenance", "branding"] as const;
   ```
   Kommentarblock L26-30 ("Event-Naming: ... jeder Listener muss seinen eigenen
   Channel-Namen tragen") entsprechend korrigieren — beschreibt nach dem Fix nicht mehr
   die Realität (ein Listener pro Aggregate, nicht pro Verb).

4. **`src/__tests__/sse-events-coverage.test.ts`** — die Coverage-Loop über
   `REQUIRED_EVENTS` (8 verb-spezifische Einträge) verliert ihre Existenzberechtigung:
   das Bug-Pattern, das sie fangen sollte ("neuer Lifecycle-Step braucht neuen
   Listener"), ist nach dem Fix strukturell unmöglich — ein Aggregate-Listener deckt
   jeden künftigen Verb automatisch ab. Ersetzen durch einen simplen Test der
   `SSE_EVENTS === ["component", "incident", "maintenance", "branding"]` behauptet
   (Regression-Schutz gegen versehentliches Zurückfallen in Verb-Enumeration), nicht
   den ganzen Parser-Mechanismus (`loadSseEvents`/`parseSseEventsFromSource`) beibehalten
   — der wird mit einer 4-Item-Konstante überflüssig.

## Kompatibilität

Kein additiver Traffic-Overhead, ein Frame pro Event wie bisher — nur der `event:`-Name
ändert sich für Entity-Events. Nicht-Entity-Events (`channel-in-app:event:delivered` und
gleichartige) sind unverändert, kein weiterer Consumer davon betroffen (geprüft: keine
andere rohe `EventSource`-Nutzung im Workspace außer `publicstatus`).

## Tests

- `sse-route.test.ts` (neuer Test, neue Harness s.o.): Event mit `aggregateType` im
  `data` erzeugt ein Frame mit `event: <aggregateType>`; Event ohne `aggregateType`
  (z. B. `channel-in-app:event:delivered`-Shape) erzeugt weiterhin ein Frame mit
  `event: <event.type>` unverändert. Bestehende Security-Tests (Channel-Scoping)
  bleiben unberührt.
- **Neu, da bisher 0 Tests:** `renderer-web/src/sse/__tests__/live-events.test.ts` —
  ein beliebiger Custom-Verb (z. B. `"archived"`) UND `"forgotten"` lösen den Listener
  aus, ohne dass irgendeine Verb-Liste im Test dupliziert wird (Test stubbt `EventSource`
  global, dispatcht ein `MessageEvent` unter dem Entity-Namen, erwartet dass der
  registrierte Listener feuert). **Teardown Pflicht** — globales `EventSource`-Stubbing
  muss nach jedem Test zurückgesetzt werden, sonst leckt es in andere Testdateien
  (bekanntes Muster in diesem Repo bei window-Property-Stubs).
- `publicstatus/src/__tests__/sse-events-coverage.test.ts`: umgebaut wie oben
  beschrieben, kein Verhalten verloren (die 4-Item-Assertion ist die einzig noch
  sinnvolle Aussage nach dem Fix).

## Größe

Zwei S-Issues, ein Repo pro Issue, harte `depends on`-Kante (publicstatus nach
kumiko-framework — Merge UND Deploy, nicht nur Merge). Kein drittes Thema, kein
Tracking-Issue-Baum nötig — Leit-Repo `kumiko-framework` trägt trotzdem ein
Haupt-Tracking-Issue, weil zwei Repos betroffen sind (Konvention: >1 Repo → immer ein
Tracking-Issue, auch bei nur 2 Sub-Issues).
