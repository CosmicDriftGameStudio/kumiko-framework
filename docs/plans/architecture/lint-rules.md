---
status: in-progress
verified: 2026-06-21
evidence: Mehrere Guards in infra/guards/ existieren (guard-cross-feature-imports.ts, guard-no-date-api.ts, guard-direct-entity-writes.ts etc.); aber doc-spezifische scripts/lint-*.ts + biome-Custom-Rules nicht implementiert — andere Architektur (kumiko-guards statt biome)
issue: kumiko-framework#274
next: Biome-Plugin-Migration evaluieren (R2/R3/R8 nach Biome-Custom-Rules falls Plugin-System reif) — R6 (Secret<>-Response-Guard) implementiert in kumiko-framework#556, R8 (no-broker-subscribe) in infra#145
---

# Kumiko Lint-Regeln (Implementierungs-Plan)

Statische Checks die Feature-Autoren vor den haeufigsten Fallen schuetzen.
Laufen in CI und als `yarn kumiko check`.

## Prinzipien

1. **Fail-fast, klare Messages.** Jede Regel erklaert **was** falsch ist, **warum**, und **wie** richtig.
2. **Biome-Regel bevorzugen, Custom-Script nur wenn noetig.** Biome ist schnell, hat gute UX, integriert mit IDEs. Custom-Scripts via `ts-morph` nur wo Biome nicht reicht (Cross-File-Analyse, Registry-Wissen).
3. **Ein Escape-Hatch pro Regel** — `// biome-ignore` Kommentar mit Begruendung moeglich, aber Code-Review muss's durchwinken. Bei Custom-Scripts: Allowlist-Datei.
4. **Teil von `yarn kumiko check`** — niemand darf Regeln "vergessen zu laufen".

## Implementierungs-Uebersicht

| Regel | Typ | Technik | Wo konfiguriert |
|---|---|---|---|
| R1: Cross-Feature-Imports | Cross-File-Pfad-Analyse | Custom `scripts/lint-cross-feature.ts` (ts-morph) | in `yarn kumiko check` |
| R2: `new Date()` im Feature-Code | AST-Pattern | Biome Custom-Rule (oder Script-Fallback) | `biome.json` |
| R3: Direkter `redis.publish` | AST-Pattern | Biome Custom-Rule oder Script | `biome.json` |
| R4: `JSON.parse`/`stringify` auf User-Input ohne Zod | Datenfluss-Analyse | Script `scripts/lint-json-parse.ts` (ts-morph) | `yarn kumiko check` |
| R5: Direct-Import von anderen Feature-Tabellen | Spezifisch zu R1, aber schaerfer | Teil von R1-Script | siehe R1 |
| R6: `JSON.stringify` auf `Secret<>`-Brand | Type-Level-Check | TypeScript-Types + Runtime-Guard im Serializer | beides — type-Verwerfung + Runtime-Fehler |
| R7: Forbidden Core-Imports aus Features | Cross-File | Custom-Script | siehe R1 |
| R8: `broker.subscribe` ausserhalb `r.onEvent`/Framework | AST + Kontext | Custom-Script | siehe R1 |

## R1: Cross-Feature-Imports verboten

### Was die Regel verbietet

```ts
// In features/orders/handlers/create.ts:
import { customerTable } from "../../customers/db/schema";          // ❌
import type { Customer } from "../../customers/types";              // ❌
import { calculateVat } from "../../invoicing/utils";               // ❌
import { UserService } from "../../user";                           // ❌
```

### Was erlaubt ist

- Imports innerhalb desselben Features (`../other-handler-in-same-feature`)
- Imports aus `@cosmicdrift/kumiko-framework` (Framework-API)
- Imports aus `@cosmicdrift/kumiko-bundled-features` wenn und nur wenn sie explizit als public-API vom Feature exportiert sind (z.B. shared Event-Namen-Konstanten — in der Praxis extrem selten)

### Implementation

`scripts/lint-cross-feature.ts`:

```ts
// Pseudocode
for each ts-file in packages/*/features/*/** and features/*/**:
  fileFeature = extractFeatureName(filePath)
  for each import-statement:
    if isRelativeImport(importPath):
      importFeature = extractFeatureName(resolve(filePath, importPath))
      if importFeature && importFeature !== fileFeature:
        error({
          file,
          line,
          message: `Cross-feature import verboten: "${importPath}" gehoert zu Feature "${importFeature}". Nutze ctx.dispatch.query/write oder Events. Siehe docs/plans/architecture/feature-integration.md`,
        })
```

Escape-Hatch: `// kumiko-lint-ignore cross-feature-import [reason]` Kommentar in derselben Zeile. Review muss's abnehmen.

### Fehler-Message-Format

```
❌ Cross-feature import verboten
   features/orders/handlers/create.ts:3
   Import von "../../customers/db/schema" gehoert zu Feature "customers"

   Warum: direkter Zugriff auf fremde Tabellen umgeht Field-Access + koppelt die
   Schemas. Refactoring von customers bricht orders ohne Warnung.

   Alternativen:
     - ctx.dispatch.query("customers:query:customer:find", ...)
     - ctx.dispatch.write("customers:write:customer:update", ...)
     - Event subscribe: r.onEvent("customers:event:changed", handler)

   Siehe: docs/plans/architecture/feature-integration.md (Abschnitt 1 + 2)
```

## R2: `new Date()` im Feature-Code verboten

### Was die Regel verbietet

```ts
// Im Feature-Handler-Code:
const now = new Date();                              // ❌
const created = new Date(userInput);                 // ❌
const iso = new Date().toISOString();                // ❌
```

### Was erlaubt ist

- `Temporal.Now.*` und alle Temporal-APIs
- `ctx.tz.now()`, `ctx.tz.today()`, etc.
- Framework-Internes in `packages/framework/src/time/**`
- In Tests: `vi.setSystemTime(...)` ist ok (vitest-API, testet Zeit)

### Implementation

**Biome-Regel** (custom, wenn das Biome-Plugin-System verfuegbar) **oder** Script:

```ts
// scripts/lint-new-date.ts
for each ts-file in packages/*/features/**, features/**, (nicht framework/src/time/**):
  for each NewExpression in AST:
    if expression === "Date":
      error({ message: "new Date() verboten. Nutze ctx.tz.* oder Temporal. Siehe timezones.md" })
```

**Exception-Liste**: `packages/framework/src/time/**`, Test-Dateien mit `.test.ts`/`.spec.ts` die `vi.setSystemTime` nutzen (eher nur Test-Setup).

### Fehler-Message

```
❌ new Date() ist in Feature-Code verboten
   features/orders/handlers/create.ts:42

   Warum: JS Date ist semantisch kaputt (Doppelnatur Instant/Wall-Clock).
   Browser-TZ wird impliziter Faktor.

   Nutze stattdessen:
     - ctx.tz.now()                 → Temporal.Instant
     - ctx.tz.nowIn("Europe/Berlin") → ZonedDateTime
     - Temporal.Now.plainDateISO()  → PlainDate

   Siehe: docs/plans/architecture/timezones.md
```

## R3: Direkter `redis.publish` im Feature-Code verboten

### Was die Regel verbietet

```ts
// Im Feature-Code
await redis.publish("channel", payload);                     // ❌
await redisClient.xAdd("stream", "*", { ... });              // ❌
```

### Was erlaubt ist

- `ctx.emit("event-name", payload)` — geht durch Outbox
- Framework-Internes in `packages/framework/src/pipeline/outbox-*` und Event-Broker

### Implementation

Script via `ts-morph`, sucht CallExpression mit `.publish(` / `.xAdd(` auf Redis-Client-Typen. Feature-Code-Dateien.

Einfacher: **Biome Custom-Rule** die nach `.publish(` sucht und Import-Source prueft (wenn aus `redis`/`ioredis`).

### Fehler-Message

```
❌ Direktes Redis-Publish im Feature-Code verboten
   features/orders/handlers/create.ts:31

   Warum: Events die direkt nach Commit an Redis gehen koennen bei Crash
   verloren gehen. Der Event-Dispatcher loest das, indem Events in derselben
   TX in den Event-Store geschrieben und cursor-basiert nach COMMIT
   publiziert werden.

   Nutze stattdessen:
     ctx.emit("orders:event:created", payload)

   Siehe: docs/plans/architecture/event-dispatcher.md
```

## R4: `JSON.parse/stringify` auf User-Input ohne Zod verboten

### Was die Regel verbietet

```ts
// Request-Body naively parsed
const data = JSON.parse(request.body);                       // ❌
```

### Was erlaubt ist

- Zod-Validator auf Input: `schema.parse(request.body)` oder `schema.safeParse(...)`
- `JSON.stringify` auf eigene-gebaute Objekte zur Serialisierung (nicht User-Input)
- `JSON.parse` auf bekannten internen Strings (z.B. jsonb-DB-Values) — allerdings Drizzle macht das sowieso fuer uns

### Implementation

Datenfluss-Analyse ist teuer. Einfache Heuristik: wenn `JSON.parse` auf einem Wert aus `request.*`, `ctx.event.*`, oder `params.*` aufgerufen wird, warnen.

Realistisch: das meiste wird durch **Zod-Schema-im-Handler** sowieso eingefangen. Die Regel ist eher Backup gegen manuelles Umgehen der Zod-Validierung.

### Alternative: weicher formulieren

Statt Regel: **Convention + Review** — Handler muessen immer Zod-Schema als zweites Argument haben, sonst Boot-Warning. Keine separate Lint-Regel noetig.

**Empfehlung**: R4 als Boot-Check, nicht als Lint-Regel. Registrar-Check "Handler ohne Schema → Warn".

## R5: Direct-Import fremder Feature-Tabellen

Spezialfall von R1, aber mit anderer Fehlermeldung die auf Tables fokussiert. Implementation: R1-Script erkennt `import { xTable } from ...` Muster und gibt gezieltere Message.

## R6: `Secret<>` in Response-Serialisierung

> **Status: implementiert** — compile-time guard in kumiko-framework#556. `defineWriteHandler`/`defineQueryHandler` lehnen ein `Secret<>` im inferierten Response-Typ ab; die Runtime-Hälfte (`assertNoSecretLeak`) bestand bereits. Hinweis zur Skizze unten: die self-referentielle Constraint `Response extends EnsureNoSecret<Response>` ist ein `TS2313`-circular-constraint-Fehler — der gelieferte Guard nutzt stattdessen einen Phantom-Rest-Param (`ContainsSecret<T> extends true ? [error] : []`), der nach der Inference prüft und so die Inference erhält.

### Was die Regel verhindert

```ts
r.queryHandler("foo", schema, async (q, ctx) => {
  const apiKey = await ctx.services.secrets.get("stripe.apiKey");
  return { success: true, apiKey };                          // ❌ Leak
});
```

### Implementation — zwei Ebenen

**Type-Level** (gratis): `Secret<T>` als Branded-Type, Response-Type des Handlers darf kein `Secret<T>` enthalten. Wenn doch: TypeScript-Fehler beim Build.

```ts
type Secret<T> = T & { readonly __secret: unique symbol };

// Response-Type-Check:
type EnsureNoSecret<T> = T extends Secret<unknown>
  ? never
  : T extends object
    ? { [K in keyof T]: EnsureNoSecret<T[K]> }
    : T;

r.queryHandler<Payload, Response extends EnsureNoSecret<Response>>(...)
```

**Runtime-Guard** (zusaetzlich): Response-Serializer prueft auf Brand-Tag, rejected + Log-Alarm. Belt-and-suspenders, falls `any` die Types aushoehlt.

### Fehler-Message (Type-Level)

```
Type 'Response' does not satisfy constraint 'EnsureNoSecret<Response>'.
  Type '{ apiKey: Secret<string> }' contains a Secret<>-branded value that
  cannot be serialized to the client.

  Siehe: docs/plans/features/core-secrets.md (Response-Guard)
```

## R7: Forbidden Core-Imports aus Features

Features duerfen `@cosmicdrift/kumiko-framework` nutzen — aber nicht **Internals** des Frameworks:

```ts
import { defineFeature } from "@cosmicdrift/kumiko-framework";                          // ✅
import { runPipeline } from "@cosmicdrift/kumiko-framework/internal/pipeline";          // ❌
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/db/tenant-db";   // ❌
```

### Implementation

In `packages/framework/package.json` wird `exports` genutzt um Internals gezielt nicht zu exportieren. Das reicht als primaere Verteidigung.

Zusaetzlich Script-Check fuer robuste Fehler-Meldung wenn jemand via relative-path auf die Internals geht.

## R8: `broker.subscribe` ausserhalb Framework verboten

> **Status: implementiert** — AST-Guard `infra/guards/guard-broker-subscribe.ts` (infra#145, `kumiko-guards`), im `run-guards`-Runner registriert. Flaggt `X.subscribe(...)` wo der terminale Receiver `broker`/`eventBroker` heisst (Name-Heuristik, keine Typ-Resolution); Ausnahme `packages/framework/src/pipeline/**`. Reiner Tripwire — heute existiert kein solcher Call (Broker ist framework-intern, nicht exportiert); Clean-Lauf gegen alle Repos. Realisiert als `kumiko-guards`-AST-Guard, nicht als `scripts/lint-broker-subscribe.ts` + Biome-Rule wie unten skizziert (gleiche andere-Architektur-Anmerkung wie im `evidence`-Frontmatter).

### Was die Regel verbietet

```ts
// Im Feature-Code:
broker.subscribe("some-event", handler);                     // ❌
```

### Was erlaubt ist

- `r.onEvent("some-event", handler)` — Registrar-API
- `r.job({ trigger: { on: "event-name" }, handler })` — Job-triggered
- Framework-Internes

### Implementation

Script-basiert: sucht nach `.subscribe(` CallExpression auf einer Variable die aus `broker` / `eventBroker`-Modulen kommt. Ausnahme: Code in `packages/framework/src/pipeline/**`.

## Zusammenfassung: `yarn kumiko check` Komposition

Der bestehende `yarn kumiko check` sollte die Regeln in dieser Reihenfolge anwenden:

```bash
yarn kumiko check
  → biome lint                      (R2, R3, R5/R1-Unterteil, R8 als Biome wenn moeglich)
  → tsc --noEmit                    (R6 type-level)
  → tsx scripts/lint-cross-feature.ts  (R1, R7, R5-Spezifik)
  → tsx scripts/lint-new-date.ts    (falls nicht als Biome-Rule)
  → vitest run                      (bestehende Tests)
  → vitest run integration          (bestehende Integration-Tests)
  → tsx scripts/guard-silent-skip.ts (bestehend)
  → boot-validation-test            (R4 als Teil vom Boot)
```

Alle mit klaren `--verbose`/`--dry-run`-Flags. Fehler stoppen die Kette.

## Scripts-Struktur

```
scripts/
  lint-cross-feature.ts         ← R1, R5, R7
  lint-new-date.ts              ← R2 (falls Biome-Rule zu schwach)
  lint-redis-direct.ts          ← R3 (ditto)
  lint-broker-subscribe.ts      ← R8 (ditto)
  guard-silent-skip.ts          ← existiert bereits
  test-helpers/
    ast-utils.ts                ← geteilter ts-morph-Kram (TS-Projekt laden, etc.)
```

Jedes Script:
- Hat `--dry-run`-Flag (liefert Report ohne Fehler-Exit)
- Hat `--verbose`-Flag
- Exit-Code: 0 bei Clean, 1 bei Fund
- Konsistente Fehler-Message mit File + Line + Message + Why + Alternative + Doc-Link

## Biome-Regel-Variante

Falls Biome Custom-Rules unterstuetzt (via JS-Plugin-System — pruefen ob schon in eurem Biome-Release):

```jsonc
// biome.json
{
  "linter": {
    "rules": {
      "kumiko/no-new-date": "error",
      "kumiko/no-redis-publish": "error",
      "kumiko/no-broker-subscribe": "error",
      "kumiko/no-cross-feature-import": "error",
    }
  }
}
```

Besser als Scripts, weil IDE sofort anzeigt. Wenn Biome noch nicht soweit ist: Scripts als Uebergang, spaeter Biome-Migration.

## IDE-Integration

- Biome hat LSP — Fehler direkt im Editor
- Custom-Scripts via pre-commit-Hook oder VS-Code-Task als Fallback
- `kumiko check` haengt im CI als required-Check

## Tests fuer die Regeln selbst

Jede Regel braucht Tests:
- Positive Test-Case (verbotenes Muster) → Fehler
- Negative Test-Case (korrekter Code) → kein Fehler
- Escape-Hatch-Test (mit `// kumiko-lint-ignore` Kommentar) → kein Fehler
- False-Positive-Tests (Borderline-Faelle) → dokumentiert was akzeptiert wird

Tests liegen in `scripts/__tests__/lint-*.test.ts`.

## Was NICHT im Scope ist

- **Performance-Regeln** (N+1-Detection, Slow-Query-Warn): andere Domaene, Observability
- **Security-Regeln** (Injection-Checks, XSS): Zod + Framework-Guards decken das ab
- **Accessibility-Regeln**: UI-Layer, andere Werkzeuge
- **Auto-Fix** der Regeln: Scripts geben Hinweise, keine automatische Code-Aenderung (zu gefaehrlich bei Cross-Feature-Import — richtige Loesung ist fall-spezifisch)

## Build-Reihenfolge

1. `scripts/lint-cross-feature.ts` — groesster Nutzen, relativ einfach
2. `scripts/lint-new-date.ts` — hoher Nutzen, einfach
3. Biome-Custom-Rules evaluieren — wenn Plugin-System reif, R2/R3/R8 migrieren
4. `scripts/lint-redis-direct.ts` — direkt nuetzlich
5. `scripts/lint-broker-subscribe.ts` — kleinere Relevanz, aber trivial
6. `Secret<>`-Type-Level-Check — braucht Handler-Type-Definition erweitern
7. Einbindung in `yarn kumiko check`
8. CI required-check
9. Tests pro Regel
10. IDE-Integration (Biome-LSP reicht meist)
