---
status: in-progress
verified: 2026-08-20
issue: kumiko-framework#2250
next: fw#2250 schliessen, sobald die Restpunkte geklaert sind (demo/-Schema-Drift, user.passwordHash ohne sensitive).
evidence: Ist-Zustand gegen engine/factories.ts (reine Objekt-Factories), boot-validator/pii-retention.ts, crypto/subject-resolver.ts, db/event-store-executor-context.ts und 132 Feld-Definitionen in 6 Repos geprüft. Datenart-Zuordnung: docs/reference/pii-flag-entscheidung.md. Umgesetzt in kumiko-framework 0.210.0; App-Rollout gemerged: kumiko-studio#200, show-pony#114, solon#205, offlot-app#49, publicstatus#373, phronexsis#464, money-horse#377, kumiko-enterprise#397.
---

# PII-Feld-API v2: `personal` + `find`

Harter Schnitt, keine Rückwärtskompatibilität — Beta, keine aktiven User.
Die alten Flags verschwinden aus der Author-API und aus allen Apps.

## Problem

Ein Feld-Autor kombiniert heute aus zwölf Flags (`pii`, `userOwned`,
`tenantOwned`, `subjectRef`, `piiEncrypted`, `encrypted`, `sensitive`,
`allowPlaintext`, `anonymize`, `lookupable`, `searchable`, `sortable`), von
denen sich mehrere gegenseitig ausschließen; verbotene Kombinationen meldet
erst der Boot. Folge im Bestand: `lastName` hat `lookupable` + `searchable`,
`firstName` nur `searchable`, `companyName` beides, `addressCountry` keins —
Drift, die niemand entschieden hat.

## Ziel-API

Zwei Angaben, beide auf der Feld-Factory:

```ts
email:              createTextField({ personal: "self",              find: "fuzzy"  }),
displayName:        createTextField({ personal: "self",              find: "fuzzy"  }),
iban:               createTextField({ personal: "self",              find: "secret" }),
addressStreet:      createTextField({ personal: "self",              find: "none"   }),
body:               createLongTextField({ personal: { of: "authorId" }, find: "none" }),
providerCustomerId: createTextField({ personal: "tenant",            find: "exact"  }),
authorId:           createTextField({ personal: "ref" }),
description:        createTextField({ personal: false, reason: "is_business_data" }),
```

### `personal` — wessen Daten (bestimmt den Key, also die Löschbarkeit)

| Wert | expandiert zu |
|---|---|
| `"self"` | `pii: true` |
| `{ of: "<feldname>" }` | `userOwned: { ownerField: "<feldname>" }` |
| `"tenant"` | `tenantOwned: true` |
| `"ref"` | `subjectRef: true` |
| `false` + `reason: string` | `allowPlaintext: reason` |

### `find` — wie findbar (nur bei `text` / `longtext`)

| Wert | expandiert zu | Bedeutung |
|---|---|---|
| `"exact"` | `lookupable: true` | Gleichheitsfilter über Blind-Index |
| `"fuzzy"` | `lookupable: true` + `searchable: true` | Volltext über Meili, plus Gleichheit |
| `"none"` | – | nicht suchbar, sonst normal lesbar |
| `"secret"` | `sensitive: true` | zusätzlich kein Write-Echo, nie im Index |

`fuzzy` schließt `exact` ein: wer Volltext will, will erst recht filtern
können, und der Blind-Index kostet eine Spalte. Das beseitigt die Drift oben
und die Klasse „warum kann ich hier nicht filtern".

Auf `longtext` gibt es nur `"none" | "secret"`. `LongTextFieldDef` hat
absichtlich kein `searchable` (Volltext über Langtext läuft über den
SearchAdapter, nicht über den Feld-Index), und der Boot-Validator lehnt
`lookupable` auf longtext ohnehin ab. Eigene Union, damit `find: "fuzzy"` dort
ein Compile-Fehler ist statt einer still danebengehenden Konfiguration.
Pflicht bleibt es trotzdem — die Frage „ist dieser Freitext ein Geheimnis" ist
eine Antwort wert.

## Typ-Union (`packages/types/src/fields.ts`)

`PiiAnnotations` wird ersetzt. `find` ist Pflicht, sobald `personal` ein
Subjekt benennt — Compile-Fehler statt Boot-Fehler, denn genau das Vergessen
hat die Lücken im Bestand produziert.

```ts
export type PersonalSubject = "self" | { readonly of: string } | "tenant";
export type Findability = "exact" | "fuzzy" | "none" | "secret";

export type PersonalAnnotations =
  | { readonly personal: PersonalSubject; readonly find: Findability;
      readonly anonymize?: () => unknown | Promise<unknown> }
  | { readonly personal: "ref" }
  | { readonly personal: false; readonly reason: string;
      readonly anonymize?: () => unknown | Promise<unknown> }
  | Record<string, never>;
```

Auf Nicht-Text-Feldern (`number`, `timestamp`, …) entfällt `find`: es gibt
weder Blind-Index noch Volltext-Index dafür. Eigene Union-Variante,
`{ personal: PersonalSubject }` ohne `find`.

**`searchable` und `sortable` bleiben im Typ** — sie gelten für Felder ohne
`personal` unverändert weiter. Was verschwindet, ist ihre Kombination mit
einer Subject-Annotation: die regelt ab jetzt allein `find`. Die Union sorgt
dafür, dass ein Feld mit `personal` sie nicht zusätzlich setzen kann.

**`piiEncrypted` entfällt auf Entity-Feldern.** Kein einziges Feld in den
6 Repos setzt es (nur `dist/`-Typdeklarationen und Tests). Es tat zwei Dinge:
drei Boot-Regeln erzwingen (Text-Feld, Subject-Annotation, `access.read`) und
in `field-access.ts:40-43` den Wert maskieren statt das Feld zu strippen, wenn
der Leser kein Leserecht hat. Beides fällt mit weg — Zugriff ist eine eigene
Achse, das hat mit Findbarkeit nichts zu tun. **Config-Keys behalten ihr
`piiEncrypted`** (`config-helpers.ts:127`, andere API), und
`piiEncryptedOnWrite` auf Store-Tables (`sessions`, `personal-access-tokens`)
ist eine Feature-Ebene tiefer und bleibt unberührt.

**`encrypted: true` bleibt** — auf Entity-Feldern wie auf Config-Keys. Es ist
keine Alternative zu `personal`, sondern eine zweite Schicht darüber:
App-Master-Key zusätzlich zum Subject-Key. `userMfa.totpSecret` und
`recoveryCodes` stapeln beides bewusst (`auth-mfa/schema/user-mfa.ts:26,41`),
und ein Tenant, der seinen eigenen SMTP-Zugang oder API-Key in einer Entity
hält, soll das Feld genauso markieren können. Orthogonale Achse, wie `access` —
nicht Teil der Union.

`anonymize` bleibt (Retention, keine Krypto).

## Wo die Expansion sitzt

In den Feld-Factories (`packages/framework/src/engine/factories.ts`). Die sind
reine Objekt-Factories mit Defaults; alles Downstream — `buildEntityTable`,
`deriveEntityTableMeta`, `boot-validator/pii-retention.ts`,
`collectPiiSubjectFields`, `collectSearchableSubjectFields`, Query-Compiler —
liest das fertige Feld-Objekt und bleibt **unangetastet**.

Die 20 Stellen im Repo, die Felder als Objekt-Literal statt über eine Factory
bauen, tragen keine PII-Flags (Event-Payload-Schemas). Der Boot-Validator
bleibt als zweites Netz unverändert bestehen.

## Umsetzung

1. **Framework-PR** — Typ-Union, Expansion in allen Feld-Factories,
   `PiiAnnotations` entfernen, `piiEncrypted` entfernen, `encrypted` von
   Entity-Feldern entfernen. Tests: eine Expansion-Tabelle (jeder
   `personal`/`find`-Wert → erwartetes Flag-Set), plus die bestehenden
   Boot-Validator-Tests auf die neue Form ziehen. Changeset (major).
2. **Codemod** — ts-morph-Script in `scripts/`, Abbildung alt → neu
   mechanisch aus der Tabelle in `docs/reference/pii-flag-entscheidung.md`.
   Sonderfälle, die es melden statt raten soll: Felder mit `lookupable` +
   `searchable` (→ `fuzzy`), Felder mit Subject-Annotation ohne jedes
   Suchflag (→ `none`), `sensitive` ohne Subject (existiert nicht, wäre
   Boot-Fail).
3. **Framework-Release**, dann pro App-Repo Version-Bump + Codemod-Lauf +
   PR: `kumiko-enterprise`, `kumiko-studio`, `publicstatus`, `solon`,
   `show-pony`.

Die App-Umstellung hängt am Framework-Release (lokal Workspace, CI published
Version), läuft also nicht im selben Durchgang wie Schritt 1.

## Nebenwirkung, bewusst in Kauf genommen

Jedes `fuzzy`-Feld bekommt eine `<snake>_bidx`-Spalte samt HMAC pro Write,
auch wo nie exakt gefiltert wird. Das ist der Preis dafür, dass die
Findbarkeit eine Leiter ist und nicht eine Auswahl aus zwei unabhängigen
Flags. Betrifft im Bestand die `searchable`-Felder ohne `lookupable`:
`user.displayName`, `contact.firstName`, `contact.displayName`,
`contact.email` (samples).

Im Framework ist das **genau ein Feld**: `user.displayName`
(`bundled-features/src/user/schema/user.ts:85`, heute `pii + searchable`).
`contact.firstName` / `contact.displayName` liegen in solon und kommen mit der
App-Umstellung. `user.email` bleibt `find: "exact"` — es hat heute
`lookupable` ohne `searchable`, und `"fuzzy"` würde dort erstmals Klartext-
Mails in den Meili-Index schreiben. Das ist eine eigene Entscheidung, keine
Nebenwirkung dieser Umstellung.

### Was daraus an DDL folgt

`display_name_bidx` ist eine neue Spalte auf `users` — also in **jeder** App,
die das user-Feature mountet, plus `demo/` im Framework-Repo.

1. `bun kumiko-schema generate` erzeugt die Migration (`<app>/kumiko/migrations`),
   handgeschrieben wird nichts.
2. `assertKumikoSchemaCurrent` (`migrations/kumiko-drift.ts`) blockt den Boot,
   solange sie fehlt — fail-closed, kein 500er im Betrieb.
3. Bestandszeilen bekommen den HMAC über den Projection-Rebuild, den
   `kumiko schema apply` über die Rebuild-Marker anstößt. Einen eigenen
   Backfill-Job gibt es nicht und braucht es nicht: `apply-entity-event`
   berechnet bidx bei jedem Replay mit.
