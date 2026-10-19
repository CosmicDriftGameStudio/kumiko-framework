---
status: in-progress
verified: 2026-06-07
evidence: Sweep 2026-05-22; mehrere ✅ erledigt (bundled-features rename, identity-hash, push-channel); mehrere ❌ offen (Doku-Klärung, Domain-Design-Lints, r.configKey, UI-Generation, CLI-Wizard)
issue: kumiko-framework#275
next: Siehe kumiko-framework#275 — r.configKey-Extension-Pattern; docs/patterns/-Guidance-Seiten (4 fehlen); Hello-…
---

# Framework-Developer-Experience — Roadmap

## Verifikations-Stand (2026-06-07)

Erledigt seit Sweep 2026-05-22: bundled-features-Rename, identity-v3-hash, channel-push, r.screen/r.nav-Primitiven.

Noch offen:
- ❌ r.configKey-Extension-Pattern (0 Treffer im Framework, nur r.config-Workaround)
- ❌ Guidance-Doku docs/patterns/ — nur custom-fields-vs-stammfields.md existiert; aggregates-and-embeds, cross-feature-communication, schema-evolution, core-vs-sample-features fehlen
- ❌ Hello-World/„was ist optional"-Einstiegspfad in docs.kumiko.rocks

Gestrichen → idea (User-Entscheid 2026-06-07): Kat. 3 (CLI-Scaffold-Wizard, Auto-UI-Generation aus r.entity)


> Original: 2026-04-21. Sweep: **2026-05-22** (siehe Status-Updates pro Item).

Kumikos Ziel: **Framework für jeden Business-Fall**. Das heißt Einstieg
muss niedrig sein, auch wenn die Runtime-Primitiven (ES, Ownership,
Upcaster, MSP, Config-Scopes) anspruchsvoll sind.

Diese Roadmap sammelt **DX-Verbesserungen**, die den Einstieg senken
ohne die Experten-API zu verwässern. Sortiert nach **Zeit-Horizont**
+ Retrofit-Kosten.

Kontext: Die Einsichten kommen aus dem BMC-Migrations-Stresstest
(2026-04-20/21). Dort wurden mehrere konkrete Framework-Lücken
aufgedeckt und das Entity-Design-Denken wurde stark gefordert — beides
fließt hier ein.

---

## Kategorie 1 — Sofort (innerhalb der nächsten Tage)

Niedrige Retrofit-Kosten jetzt, wachsen linear mit Code-Basis.

### ✅ `core-features` → `bundled-features` Umbenennung (erledigt 2026-04-22)

**Warum war das nötig**: „core" impliziert „obligatorisch" — dabei sind
diese Features **mitgelieferte Bausteine**, optional ersetzbar. Der
Name stand Kumikos Selbstverständnis („Framework für jeden
Business-Fall") entgegen: Teams hätten gedacht, sie müssten alles aus
dem Core-Package nutzen.

**Was wurde gemacht**:
- Ordner: `packages/core-features/` → `packages/bundled-features/`
- Package-Name: `@cosmicdrift/kumiko-core-features` → `@cosmicdrift/kumiko-bundled-features`
- Alle Sample-Imports, Scripts, Framework-Kommentare, Plan-Dokumente

**Alternativen die verworfen wurden**:
- `standard-features` (zu neutral, sagt nicht dass sie optional sind)
- `starter-features` (impliziert Einsteiger-Level, ist aber Prod-Code)
- `batteries-included` (spielerisch, nicht selbsterklärend)

→ `bundled-features` gewann: klar „mitgeliefert", keine Notwendigkeit
impliziert, direkt verständlich.

### Doku-Klärung: „was ist optional?" 🟢 ❌ offen 2026-05-22

**Warum**: Neue Teams sehen `Ownership`, `MultiStreamProjection`,
`Upcaster`, `Config-Scopes`, `System-Hooks` und denken „das muss ich
alles verstehen". Tatsächlich sind alle **opt-in** — ein Hello-World
kommt ohne aus.

**Umfang**:
- In `uebersicht.md` eine Sektion „Hello-World vs. Advanced" einführen
- Sichtbar markieren welche Features **obligatorisch** sind (Engine,
  Pipeline, Dispatcher) vs. **optional** (ES-Primitiven, Ownership,
  MSP)
- Einsteiger-Pfad beschreiben: „So fängt man an, ohne ES-Vokabular"

---

## Kategorie 2 — Aktuell (Sprint I / nächste Wochen)

Mittlere Retrofit-Kosten, hoher DX-Gewinn. Jetzt einplanen, bevor
erster externer Adopter kommt.

### `yarn kumiko check` um Domain-Design-Lints erweitern 🟡 ❌ offen 2026-05-22

**Warum**: Jedes Team muss beim Entity-Design dieselben Entscheidungen
treffen — embedded vs. Sub-Event vs. eigenes Aggregate, wann
required, wann Snapshot, wann Sub-Aggregate. Ohne Leitplanken
erfindet jedes Team das Rad neu.

**Umfang**: Zusätzliche Warnungen (nicht Fails) in `yarn kumiko check`:

```
⚠ Entity hat Array-Field
  → Erwägst du Sub-Events oder eigenes Aggregate? (docs/patterns/arrays-in-es.md)

⚠ Entity hat >15 Felder
  → Prüfe ob Felder in Sub-Aggregate oder Config-Keys gehören.

ℹ Wachsende Collection (Messages) als embedded Array
  → Erwägst du Sub-Events statt embedded?

⚠ Entity ohne Events definiert, aber writeHandler existiert
  → Event-Log fehlt — absichtlich?
```

Warn-Level, nicht Fail. Code-Kommentar-Stummschalter für bewusste
Abweichungen (`// kumiko-check-ignore: arrays-in-es — bewusst embedded`).

**Retrofit-Kosten**: Je mehr Features existieren, desto mehr müssen
Warnungen entweder bereinigt oder bewusst stummgeschaltet werden.
Früh einführen → wenige Fälle heute, viele später wenn gebraucht.

### Guidance-Doku-Seiten 🟢 ❌ offen 2026-05-22 (Material teils in `docs.kumiko.rocks` Recipes vorhanden, aber nicht als kanonisch `docs/patterns/` zusammengeführt)

**Warum**: Die Entscheidungs-Trees die jedes Team trifft (embedded
vs. Aggregate, Sub-Feature vs. Extension, Cross-Feature-Kommunikation)
gehören kanonisch in die Doku. Sonst verbringen Teams Zeit damit, das
selbst herzuleiten — oder entscheiden falsch.

**Umfang**:
- `docs/patterns/aggregates-and-embeds.md`
  - Entscheidungs-Flowchart (eigener Lifecycle? eigene Concurrency?
    wächst unbegrenzt? → Aggregate. Sonst embedded / Sub-Event)
  - Konkrete Beispiele mit Code (Invoice+Lines = embedded;
    Chat+Messages = Sub-Event; Order+DriverOrder = separate Aggregate)
  - Anti-Pattern-Sammlung („tu das nicht, weil…")
- `docs/patterns/cross-feature-communication.md`
  - Wann `r.requires`? Wann Extension? Wann eigenes Feature?
  - Event-Fan-Out-Patterns (postSave-Hook + appendEvent am anderen Stream)
- `docs/patterns/schema-evolution.md`
  - Wann Event-Versioning?
  - Wann Upcaster?
  - Migration-Kosten pro Evolution-Typ
- `docs/patterns/core-vs-sample-features.md`
  - Wann sollte ein Feature in `bundled-features` wandern?
  - Wann bleibt es Sample-lokal?

Das Material existiert teilweise schon in Architektur-Dokumenten und
in BMC-Migrations-Plänen — muss nur in kanonische Doku-Seiten
umgegossen werden.

### BMC-aufgedeckte Framework-Lücken schließen 🟡

Vier konkrete Framework-TODOs die aus BMC-Migrations-Planung stammen:

**1. ✅ `@cosmicdrift/kumiko-bundled-features` exportiert Command-Schemas (erledigt 2026-04-25)**

`TenantCommandSchemas` und `UserCommandSchemas` aus
`@cosmicdrift/kumiko-bundled-features/{tenant,user}` exportieren die Zod-Schemas der
Write-Handler. Migration-Mapper (BMC) validieren ihre Payloads damit
vor `appendRaw` in die Core-Streams.

Files: `packages/bundled-features/src/{tenant,user}/command-schemas.ts`,
Round-Trip-Test in
`samples/beammycar/src/migration/__tests__/core-schema-export.integration.ts`.

Caveat dokumentiert in beiden command-schemas.ts: Schema = Command-Input.
Event-Payload für `*.created` = Command minus `id`, `applyDefaults` +
`stripSensitive` + `flattenCompoundTypes` (CrudExecutor-Pipeline).
Mapper muss strip-id selbst replizieren — `aggregateId` lebt am Event-Row,
nicht im Payload.

**2. ✅ Identity-V3-Hash-Verifier in `auth-email-password` (erledigt 2026-04-25)**

`verifyPassword` sniff-routet zwischen argon2id (Standard) und ASP.NET
Core Identity V3 (PBKDF2-HMAC-SHA256/HMACSHA512, 16-byte Salt, 32-byte
Subkey). Migrierte Legacy-Hashes 1:1 in `user.passwordHash` →
`/api/auth/login` funktioniert ohne Reset-Flow.

Files: `packages/bundled-features/src/auth-email-password/identity-v3-hash.ts`,
Unit-Tests in `__tests__/identity-v3-hash.test.ts` (12 Tests:
Format-Sniff, BMC-Profile HMAC256/10k, HMAC512-Variante, malformed
Inputs), End-to-End-Login-Beweis in `__tests__/identity-v3-login.integration.ts`
(2 Tests: korrektes Password → 200 + JWT, falsches → 401).

Nicht als primärer Hasher — nur Verifier. Neue Hashes bleiben argon2id.
Auto-Rehash auf Login (V3 → argon2id) ist absichtlich nicht eingebaut;
nächste change-password / reset-password schreibt sowieso argon2id.

**3. ❌ `core:config` akzeptiert Feature-Extension-Keys (Stand 2026-05-22: offen)**

Legacy-Systeme haben oft viele Feature-Flags/Settings am Tenant, die
nicht zu Kumikos Standard-Config-Keys passen (z.B. BMC
`FeatureTimeTracking`, `AutomaticProtocolSending`,
`MinPickupOffsetInDays`, …).

Lösung: Config-Feature erlaubt, dass andere Features eigene Keys
registrieren (analog zum Extension-Pattern bei `deliveryChannel`).

Status: Kein `r.configKey()`-Pattern im engine. Workaround heute via `r.config()` mit Default-Werten pro Feature.

**4. ✅ Push-Channel-Plugin (Stand 2026-05-22: Foundation done)**

`packages/bundled-features/src/channel-push` ist als Bundle live:
- `createPushChannel({ transport, resolveToken })`-Factory implementiert `DeliveryChannel`
- Generic `PushTransport`-Adapter-Type — konkrete Adapter (Expo-Push, APNs, FCM) sind Consumer-Implementation
- Wired in `bundled-features`-Workspace, in `uebersicht.md` Core Features-Tabelle als ✅ markiert

Konkrete Provider-Adapter (Expo/APNs/FCM) sind nach wie vor Consumer-Verantwortung — das Channel-Foundation-Layer ist fertig.

---

## Kategorie 3 — Später (nach BMC-Migration / mid-term)

Niedrige Retrofit-Kosten (rein additiv), aber größerer Bau-Aufwand.
Lohnt nach dem Stresstest, wenn klar ist dass die Fundament-Design-
Entscheidungen tragen.

### UI-Generation aus `r.entity` 🟢 ❌ offen 2026-05-22 (UI-M1 Framework-Primitiven `r.screen` + `r.nav` 2026-04-22 erst Phase 1-Vorbereitung; Auto-UI-Generation noch nicht in der nächsten Welle)

**Warum**: Der „Django-Admin"-Effekt — Team definiert Entity, bekommt
automatisch eine CRUD-Admin-Seite ohne eine Zeile Frontend-Code. Das
senkt den Einstieg auf Rails-/Django-Scaffold-Niveau.

**Vorteile die sich addieren**:
- Niedrige Einstiegshürde (keine React/Form-Library-Kenntnisse nötig)
- Entity-Design wird **instant** validiert: hässliche Auto-UI → Entity-
  Modell ist schief
- Progressive Customization: Default-UI, überschreibbar via
  `r.entity(..., { ui: { listColumns, formLayout, hidden } })`

**Umfang**:
- Phase 1: `r.entity` rendert automatisch Admin-CRUD (React-Komponenten,
  expo-tauglich)
- Phase 2: UI-Overrides via Entity-Option
- Phase 3: „UI-Metadata-Layer" für Form-Sektionen, Pflicht-Overrides
  pro Tenant (ähnlich BMCs `fields.json`-Konzept)

Das Field-Type-System in `packages/framework/src/engine/types/fields.ts`
ist schon das Fundament — `text`/`boolean`/`select`/`number`/`money`
mit `required`/`access`/`sensitive` tragen alle Infos die ein
UI-Generator braucht.

### CLI-Scaffold-Wizard 🟢 🟡 partial 2026-05-22 — L4 `ai-generate` deckt einen großen Teil ab (`generate_feature` Tool-Use produziert komplette feature-files mit entity/handler/test). Klassischer interaktiver CLI-Wizard noch offen, würde aber durch L6 CLI (`kumiko ai "build me X"`, ~0.5 Wo geplant) abgedeckt

**Warum**: „Vor dem weißen Blatt sitzen" ist der größte Einstiegs-
Blocker. Ein interaktives `yarn kumiko new feature` erzeugt ein
funktionsfähiges Feature-Skelett mit wenigen Fragen.

**Umfang**:
```
$ yarn kumiko new feature
? Feature-Name: customer
? Hat das Feature ein Haupt-Entity? (Y/n) Y
? Entity-Name: customer
? Welche Felder? [interaktive Auswahl mit Field-Types]
? Soll CRUD-UI generiert werden? (Y/n) Y
? Multi-Tenant-Trennung? (Y/n) Y
? Event-Sourcing (ES-Aggregate)? (y/N) n
? Tests automatisch scaffolden? (Y/n) Y
→ Erzeugt: packages/features/customer/ mit allem Nötigen
```

Reduziert „Framework verstehen → erstes Feature" von Stunden auf
Minuten.

### Advanced Guidance-Tools 🟢

Weiterführende DX-Werkzeuge, wenn Kategorie 2 etabliert ist:

- **Decision-Tree-CLI** (`yarn kumiko guide`): beantwortet Fragen wie
  „ich habe ein Feature mit X, soll ich Y verwenden?" via Flowchart
- **Refactoring-Assistent**: wenn Lint sagt „erwägst du eigenes
  Aggregate", bietet ein `yarn kumiko refactor` die Extraktion an
- **Framework-Explorer** (Web-UI): Aggregate-Graph, Event-Flow,
  Feature-Dependencies visualisiert

---

## Zielgruppen-Klärung

Entschieden via Marketing-Pivot 2026-04-28: **Variante B mit AI-Layer**
(„Plattform powered by Framework"). Twin-Narrative für DACH-Mittelstand
(DE) + Indie-Hacker (EN).

Vollständige Zielgruppen-Story: [`marketing/story.md`](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/marketing/story.md).
Build-Reihenfolge: [`marketing/roadmap.md`](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/marketing/roadmap.md).

Die Variante-A-vs-B-Analyse von April 2026 liegt im Archiv:
`_archive/2026-05-pre-platform-pivot/` (kumiko-platform).

Die DX-Empfehlungen aus diesem Dokument (progressive Disclosure,
Hello-World ohne ES-Vokabular, Linter-Warnungen) bleiben gültig — sie
unterstützen Variante B aktiv.

---

## Beziehung zu anderen Plänen

- **BMC-Migrations-Plan** (`docs/plans/samples/beammycar-migration.md`):
  Die vier Framework-TODOs aus „Kategorie 2" stammen aus dem dort
  aufgetretenen Bedarf. Der Migrations-Plan verweist auf dieses
  Dokument statt die TODOs doppelt zu führen.
- **Priorisierung** (archiviert → [STATUS.md](https://github.com/CosmicDriftGameStudio/kumiko-platform/blob/main/docs/plans/STATUS.md)): Kategorie 1 +
  Kategorie 2 könnten in die nächste Welle dort eingeordnet werden.
- **Übersicht** (`docs/plans/uebersicht.md`): nach Umbenennung (Kategorie 1)
  müssen alle Referenzen auf `@cosmicdrift/kumiko-bundled-features` angepasst werden.
