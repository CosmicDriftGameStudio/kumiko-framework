---
status: in-progress
verified: 2026-10-29
issue: kumiko-framework#4124
next: S2 (Regel-Tabellen) und S4 (boot-rules.md, Drift- und Ratchet-Guard) sind in Arbeit (PR feat/boot-rules-s2-s4); danach S-Studio (validate --json) und S5 bis S8
---

# Boot-Regel-Registry: alle Boot-Fehler in einem Lauf, mit stabiler Regel-ID

Marc hat am 2026-10-28 entschieden: Runde 1 umfasst S1 (Sammler und Phasen) und S3 (eine
`✗`-Zeile pro Verstoß in `validate`, plus `--json`). S2 und S4 bis S8 folgen in einer späteren
Runde. E1 bis E8 gelten wie empfohlen (Abschnitt 7).

## Anlass

Die Machbarkeitsmessung des KI-Designers (kumiko-studio#480, PR #483,
`kumiko-studio/docs/plans/studio-designer-messung.md`) lässt Sonnet Apps über einen Prüfloop
bauen: typecheck, `kumiko-schema generate`, `kumiko-schema validate`, build, tests. Die
Boot-Prüfung meldet pro Lauf genau einen Fehler. Der Fall „Unterweisung" brauchte fünf
Prüfläufe hintereinander, jeder mit einer neuen Meldung, und lief ins Rundenlimit:

1. Subject-Key-Feld mit `sortable: true` (`pii-retention.ts`, `rejectCiphertextSortOrSensitiveSearch`)
2. fehlender i18n-Key `unterweisung:entity:__action-form__:field:employeeId` (`i18n-keys.ts`, `validateI18nSurfaceKeys`)
3. `defaultSort` fehlt bei searchable/filterable (`entity-list-screens.ts`, `validateOneEntityListScreen`)
4. `searchable: false` bei einer Operator-Liste (dieselbe Funktion, derselbe Screen)
5. user-data-rights-bootCheck „has user-subject fields but no feature registers an EXT_USER_DATA hook" (`bundled-features/src/user-data-rights/boot-checks.ts`)

Weitere gesehene Meldungen: mehr als 3 Meta-Spalten in Listenkarten (`card-meta-overflow.ts`),
Action-Icon, fehlendes `requires("user-data-rights")` (vermutlich `api-ext.ts:77`, Extension
ohne requires), Nav-id nicht kebab-case (`feature-ui-extensions.ts:164`, siehe Schicht 0 unten).

Ziel der Runde: ein Prüflauf meldet alle unabhängigen Verstöße, jeder mit stabiler Regel-ID,
Ort und Fix-Text, maschinenlesbar für `kumiko check` und den Studio-Prüfloop und lesbar für
Menschen.

## 1. Ist-Zustand

### Schichten, in denen Boot-Fehler entstehen

Stand `origin/main` am 2026-10-28 (Version-Packages-Commit df1a73923). Gezählt sind
`throw new Error` außerhalb von Tests.

| Schicht | Wann | Ort | Throws |
|---|---|---|---|
| 0 Definition | beim Import von `kumiko/schema.ts`, in `r.*`-Aufrufen | `engine/feature-ui-extensions.ts` (42), `feature-config-events-jobs.ts` (16), `entity-handlers.ts` (12), `changeset-changes.ts` (10), `feature-probes.ts` (9), `event-def.ts` (8), `define-feature.ts` (6), weitere | ca. 119 |
| 1 createApp-Vorprüfung | `createApp()`, vor `validateBoot` | `engine/create-app.ts` (Rollen, Währungen) | 9 |
| 2 validateBoot | `validateBoot()` | `engine/boot-validator/*.ts` (52 Dateien), plus 2 Inline-Throws in `index.ts` | 526 |
| 3 Registry | `createRegistry()`, einmal innerhalb von validateBoot (siehe unten), sonst danach | `engine/registry-validate.ts` (46), `registry-ingest.ts` (29), `registry-state.ts` (5) | ca. 80 |
| 4 Feature-bootChecks | in validateBoot über `validateFeatureBootChecks` | FW-bundled: 15 `r.bootCheck`-Registrierungen in 9 Features, 13 Throws in `*/boot-checks.ts`; Enterprise: 3 Registrierungen (`ai-agent` 2, `ai-foundation` 1) | 13 + Enterprise |

Die 526 Throws in `boot-validator/` verteilen sich ungleich: `entity-handler.ts` 89,
`screens-dashboard.ts` 67, `screens-forms.ts` 54, `screens-actions.ts` 37, `config-deps.ts` 23,
`pii-retention.ts` 20, `screens-lists.ts` 19, `screens-kind-projection-detail.ts` 18,
`projection-list-screens.ts` 17, `form-derivations.ts` 16, Rest unter 15 pro Datei.

### Ablauf von validateBoot

`packages/framework/src/engine/boot-validator/index.ts`, `validateBoot(rawFeatures, options)`,
Doc-Kommentar „Throws on the first error found — fail fast":

1. **Sammeln und Struktur:** `dedupeFeatures`, Feature-Map, Extension-Provider, Config-Keys,
   Claim-Keys, `collectKnownRoles`, Screen-, Nav-, Workspace- und Write-Handler-QNs.
   Dazwischen werfen bereits `validateScreenShortIdCollisions`, `collectDetailForScreens`
   (Eindeutigkeit von detailFor) und die Inline-Prüfung auf doppelt exponierte APIs.
2. **Schleife pro Feature** (40 Validatoren in fester Reihenfolge): `validateCircularDeps`,
   Felder (encrypted, searchable, file, PII/Retention, record-owned, select, embedded,
   reference, image), Handler-Feldreferenzen, Transitions, lockedWhen, Extensions,
   Access, Indizes, Config-Keys (7 Prüfungen), Ownership, Parent-Refs, Transfer-Graph,
   Multi-Stream-Projektionen, `validateActionWiring`/`validateFieldWiring`,
   `validateScreens`, `validateNavs`, `validateWorkspaces`.
3. **App-weit** (20 Prüf- und Warnaufrufe): Nav-Zyklen, Nav-Warnungen, Default-Workspace, i18n (drei
   Prüfungen), entityList-Screens, URL-Prefill, Card-Meta, `validateQueryRefs`,
   Selector-Panels, Query-Output-Spalten, Projection-Listen, Related-List-Queries,
   PreSave-Wiring, GDPR-Storage (nur Warnung), Global-Tenancy, Feature-bootChecks,
   Projection-Allowlist.
4. **Umgebung:** Verschlüsselungs-Keyring (`validateEntityFieldEncryptionAvailable`),
   `FILE_STORAGE_PROVIDER` (Inline-Throw), dann `validateConfigReads` und die Warnungen.

Jeder Validator wirft beim ersten Verstoß, und der Throw beendet den ganzen Boot. Das gilt auch
innerhalb eines Validators: `FIELD_RULES` in `pii-retention.ts` ist schon eine typisierte
Regeltabelle, aber der Kommentar sagt „the first failing rule decides the boot error".

### Vorhandene Sammel-Mechanismen

Es gibt sie nur punktuell, jeweils innerhalb einer einzelnen Regel:

- `validateCardMetaOverflow` sammelt alle Screens über `collectCardMetaOverflow` und wirft
  einen Fehler mit Liste. `collectCardMetaOverflow` ist exportiert und wird von phronexsis
  und der Studio-Demo-App in Tests genutzt.
- `validateTranslationLocaleConsistency` und `validateRequiredLocales` sammeln alle
  Locale-Lücken in eine Meldung.
- `validateI18nSurfaceKeys` sammelt **nicht**: jeder fehlende Key braucht einen eigenen Lauf.

Kein übergreifender Collector, kein Regel-Register, keine Regel-ID. Die einzige
Try/Catch-Stelle mit Umverpackung ist `validateFeatureBootChecks` (`boot-check.ts`): sie
fängt den Fehler eines bootChecks und wirft `[Feature X] r.bootCheck failed: <message>`, bricht
also ebenfalls beim ersten fehlschlagenden bootCheck ab.

### Warnungen

Warnungen laufen über `createFallbackLogger("kumiko:boot").warn` (landet in `console.warn` mit
Präfix `[kumiko:boot]`): Nav-Access-Inversion, unerreichbare Nav-Screens, toggelbare
Abhängigkeiten, eindeutige Access-Rollen (opt-in), ungenutzte APIs, fehlende Security-Baseline
(nur production), GDPR-Storage, PII-Heuristiken (4 Stellen in `pii-retention.ts`). Sie brechen
nie ab. Consumer-Tests filtern ihren Text (siehe Abschnitt 4).

### Bekannte Reihenfolge-Abhängigkeiten

Im Code dokumentiert:

- `index.ts:318`: `validateActionWiring` vor `validateScreens`, sonst meldet `validateScreens`
  bei einer Function als Wert irreführend „unknown field undefined".
- `index.ts:359`: `validateQueryRefs` vor `validateProjectionListScreens`, sonst wird eine
  unauflösbare Query als „no search parameter in its Zod schema" gemeldet.
- `index.ts:365` und `query-output-columns.ts:26`: `validateQueryOutputColumns` setzt voraus,
  dass jede `query` aufgelöst ist.
- Strukturell: Eindeutigkeit von Short-IDs, detailFor und API-Namen wird vor der Schleife
  geprüft, weil die Schleife diese Maps nutzt.
- `validateI18nSurfaceKeys` ruft `createRegistry(features)` auf. Damit laufen die ca. 80
  Registry-Throws (Schicht 3) mitten in validateBoot, mit ihren eigenen Annahmen über einen
  gültigen Feature-Satz. `validateExtensionPreSaveWiring` läuft in validateBoot und in
  createRegistry ein zweites Mal.

### Aufrufer

| Aufrufer | Datei | Verhalten bei Fehler |
|---|---|---|
| `createApp` | `framework/src/engine/create-app.ts:179` | wirft durch |
| Prod-Server | `server-runtime/src/boot/shared-boot-steps.ts:78` (`validateComposedFeatures`) | Prozess crasht |
| Worker | `server-runtime/src/boot/worker-boot-core.ts:170` | Prozess crasht |
| Dev-Server | `dev-server/src/run-dev-app-config.ts` (`validateDevBoot`, über `validateComposedFeatures`) | wirft vor dem Socket |
| `kumiko-schema validate` | `framework/src/schema-cli/validate-command.ts:82` (`checkBootValidity`) | druckt `  ✗ boot: <message>` über `describeThrown` (nur `e.message`), Exit 1 |
| `kumiko check` | `cli/src/commands/check.ts:285`, Schritt `boot` ruft `runSchemaCli(["validate"])` | wie oben |
| Test-Stack | `testing/src/stack/test-stack-setup.ts:201-202` (`validateNavBootSubset`, optional voll) | wirft |
| Scaffolds | `testing/src/scaffold.ts:155`, `dev-server/src/scaffold-app-feature.ts:204` | erzeugen `expect(() => validateBoot(...)).not.toThrow()` |

## 2. Folgefehler und Phasen

Wer einfach alle Throws fängt und weiterläuft, bekommt Folgefehler: eine unaufgelöste Query
erzeugt in drei späteren Prüfungen irreführende Meldungen, eine Function statt Boolean lässt
`validateScreens` mit `undefined`-Text werfen, und spätere Prüfungen können mit `TypeError`
auf Daten crashen, die eine frühere Regel hätte abweisen sollen.

Vorschlag: vier Phasen in einer eigenen Datei `boot-validator/boot-phases.ts` (die Tabelle
gehört nicht in `index.ts`, die hat schon 396 Zeilen). Innerhalb einer Phase wird gesammelt.

| Phase | Inhalt | Begründung |
|---|---|---|
| P1 Struktur | Short-ID-Kollisionen, detailFor-Eindeutigkeit, API-Namen-Eindeutigkeit, `validateCircularDeps`, `validateExtensionUsages`, `validateApiExposureMatching`, `validateReferenceFields`, `validateParentRefs`, `validateQueryRefs` (vorgezogen) | Alles, worauf andere Prüfungen Maps oder Auflösung aufbauen |
| P2 Deklarationen pro Feature | restliche Feature-Schleife | lokal an Feld, Entity, Handler, Screen |
| P3 App-weit | Nav-Zyklen, Workspaces, Registry-Aufbau als eigene Prüfung, danach i18n, entityList, Card-Meta, Query-Output-Spalten, Projection-Listen, Related-Lists, PreSave, Global-Tenancy, Feature-bootChecks, Projection-Allowlist, Config-Reads | braucht den ganzen Feature-Satz |
| P4 Umgebung | Keyring, `FILE_STORAGE_PROVIDER` | hängt nicht an Deklarationen, läuft immer |

Regeln, die Folgefehler verhindern:

- **Abbruch nach P1**, wenn P1 Verstöße hat. P2 und P3 laufen zusammen (Entscheidung E1).
- **Paar-Skip in P2:** Meldet `validateActionWiring` oder `validateFieldWiring` für ein
  Feature einen Verstoß, wird `validateScreens` für dieses Feature übersprungen.
- **Registry als eigene Prüfung in P3:** Wirft `createRegistry`, wird der Verstoß gemeldet und
  `validateI18nSurfaceKeys` übersprungen, statt dass Registry-Fehler als i18n-Fehler erscheinen.
- **Crashes sind keine Verstöße:** Fängt eine Grenze etwas anderes als einen Regelverstoß
  (`TypeError`, `RangeError`, ...) und die Phase hat schon Verstöße, gilt es als Folgefehler
  und wird unterdrückt. Ohne vorherige Verstöße wird es unverändert geworfen, denn dann ist es
  ein echter Bug.

### Abnahmetest: der Fall Unterweisung

| Fehler | Phase | Wird gemeldet, wenn ... |
|---|---|---|
| (1) sortable + Subject-Key | P2 | Grenze pro Eintrag in `FIELD_RULES` |
| (2) i18n-Key fehlt | P3 | `validateI18nSurfaceKeys` sammelt alle fehlenden Keys |
| (3) defaultSort fehlt | P3 | `validateOneEntityListScreen` wird Regeltabelle mit Grenze pro Regel |
| (4) searchable: false | P3 | wie (3); vermutlich ohnehin nur entstanden, weil Sonnet (3) umgehen wollte |
| (5) EXT_USER_DATA-Hook fehlt | P3 | Grenze pro bootCheck |

Mit E1 = Empfehlung: **ein** Prüflauf statt fünf. Mit Abbruch nach jeder Phase: zwei. Eine
Grenze pro Validator-Aufruf allein reicht nicht, weil (3) und (4) aus derselben Funktion für
denselben Screen kommen. Deshalb gehören die Messungs-Hotspots schon in Runde 1 auf Grenzen
pro Regel.

Die Messung wird nach der Runde mit demselben Fall wiederholt; Erfolg heißt höchstens ein
Boot-Prüflauf pro Fehlerbündel.

## 3. Design

### Regel und Verstoß

```ts illustration
// boot-validator/boot-rule.ts (neu, Typen + zwei Funktionen)
export type BootRule = {
  readonly id: BootRuleId;          // "pii/subject-key-sortable", nie umbenannt
  readonly summary: string;         // eine Zeile, für boot-rules.md
  readonly fix: string;             // generischer Fix-Text
};

export type BootViolation = {
  readonly ruleId: string;          // oder "unclassified/<check>" für alte Throws
  readonly check: string;           // Name der Prüfung, z. B. "validatePiiAndRetention"
  readonly feature?: string;
  readonly location?: string;       // "entity unterweisung, field employeeId"
  readonly message: string;         // konkreter Text mit Namen
  readonly fix?: string;            // Regel-Fix, optional am Ort präzisiert
};

export class BootRuleViolation extends Error { readonly violation: BootViolation }
export class BootValidationError extends Error { readonly violations: readonly BootViolation[] }

export function bootRuleError(rule: BootRule, details: ViolationDetails): BootRuleViolation;
```

Regeln stehen pro Validator-Datei als typisierte Tabelle:

```ts illustration
export const PII_RULES = {
  subjectKeySortable: {
    id: "pii/subject-key-sortable",
    summary: "A subject-key field cannot be sortable.",
    fix: 'Drop sortable, use find: "exact" for lookups, or keep the field plaintext (personal: false).',
  },
} as const satisfies BootRuleTable;
```

Ein `defineBootRule()`-Wrapper bringt gegenüber `satisfies` nichts außer einem Funktionsaufruf;
der Vorschlag aus der Session wird deshalb auf die Tabelle reduziert (siehe E2). Eine zentrale
Liste `boot-validator/boot-rules.ts` importiert alle Tabellen; ein Test prüft eindeutige IDs.

### Werfen bleibt, gesammelt wird an Grenzen

Validatoren werfen weiter, nur typisiert: `throw bootRuleError(PII_RULES.subjectKeySortable, {...})`.
Gesammelt wird an Grenzen, die ein Collector setzt:

```ts illustration
const report = createBootReport();
report.check("validatePiiAndRetention", feature.name, () => validatePiiAndRetention(feature));
report.each(FIELD_RULES, (rule) => rule(input));     // Grenze pro Regel
report.endPhase("P1");                               // wirft BootValidationError, wenn P1 Verstöße hat
...
report.finish();                                     // wirft BootValidationError mit allen Verstößen
```

Warum Werfen statt `report.push(...)` plus `return`: Code nach einem Throw darf annehmen, dass
die Bedingung gehalten hat. Ein Push braucht an jeder Stelle eine eigene Entscheidung, ob
`continue`, `return` oder weiter, und ist damit weder codemod-fähig noch sicher. Mit Throw
ändert die Migration einer Stelle nur den Ausdruck hinter `throw` (E3).

Alte `throw new Error(...)` aus dem Boot-Pfad werden an der Grenze als
`unclassified/<check>` gesammelt. **Damit sammelt Runde 1 sofort alle 526 Stellen**, auch
bevor eine einzige Regel eine ID hat. Registrierung und Sammeln sind getrennte Schritte.

### Fehlerformat

`validateBoot` behält seine Signatur und wirft weiterhin genau einen Fehler, jetzt
`BootValidationError` (Unterklasse von `Error`) mit `violations`:

```text
Boot validation failed: 3 violations
- [pii/subject-key-sortable] [Feature unterweisung] Field "employeeName" on entity "unterweisung" combines a subject-key annotation with { sortable: true } ...
  Fix: Drop sortable, use find: "exact" for lookups, or keep the field plaintext (personal: false).
  Rule: agents/boot-rules.md#pii-subject-key-sortable
- [unclassified/validateEntityListScreens] [entityList] Feature "unterweisung" screen "unterweisung-list": defaultSort required ...
- ...
```

Jeder bisherige Meldungstext steht unverändert in der Gesamtmeldung. Das ist die
Kompatibilitätszusage für alle `toThrow(/.../)`-Asserts (Abschnitt 4).

### Maschinenlesbar

`kumiko-schema validate` (und damit `kumiko check`):

- Text: eine `  ✗ boot [<ruleId>] <message>`-Zeile pro Verstoß, Fix in einer eingerückten
  Folgezeile. Heute druckt `checkBootValidity` genau eine `✗`-Zeile.
- `--json`: `{ "boot": { "ok": false, "violations": BootViolation[] } }` auf stdout (E4).

### Generierte Doku

`packages/framework/agents/boot-rules.md`: eine Zeile pro Regel (ID, Summary, Fix, Datei),
gruppiert nach Bereich, mit Ankern. Der Generator (`packages/guards/src/_lib/agent-docs-boot-rules.ts`,
neu, unter 300 Zeilen) importiert die zentrale Regelliste zur Laufzeit; guards hat das
Framework schon als Peer- und Dev-Dependency. Der Drift-Guard `agent-docs-drift` deckt die
Datei automatisch ab, sobald `renderAgentDocs` sie liefert; `AGENTS.md` bekommt eine Zeile in
der Dateitabelle, und Schritt 6 („Boot errors name the fix") verweist auf die Datei (E5).

### bootChecks von Features

- Runde 1: jeder registrierte bootCheck läuft in einer eigenen Grenze, alle werden gemeldet.
  Das Präfix `[Feature X] r.bootCheck failed:` bleibt, Consumer-Tests matchen den Text dahinter.
- Bundled Features dürfen `bootRuleError` mit eigenen Regeln werfen
  (`user-data-rights/missing-user-data-hook`), exportiert über `@cosmicdrift/kumiko-framework/engine`.
- Enterprise-Regeln landen nicht in der FW-`boot-rules.md` (E6).

### Warnungen

Runde 1 lässt Warnungen unverändert: gleicher Text, gleicher Logger. offlot-app, solon und
money-horse filtern `console.warn` auf den Text. Später können Warnungen Regeln mit
`severity: "warning"` werden, mit identischer Log-Zeile.

### Ratchet

Temporärer Guard `guard-boot-raw-throws`: zählt `throw new Error(` in
`engine/boot-validator/**` und `bundled-features/src/*/boot-checks.ts` pro Datei gegen
`.kumiko-boot-raw-throws-baseline.json` (Muster wie die übrigen `.kumiko-*-baseline.json`,
Vergleich über `_lib/baseline-compare.ts`). Die Zahl darf nur sinken. Bei 0 werden Guard und
Baseline gelöscht. Das widerspricht dem Eintrag vom 2026-10-20 („Error classes are closed by
types, boot or runtime before a guard") nicht, weil der Guard keine Fehlerklasse der Apps
abdeckt, sondern eine Migration im Framework-Code begrenzt und mit ihr verschwindet (E7).

### Grenzen der Runde

- Komplexität: die Obergrenze ist 40 (Eintrag 2026-10-22 „Complexity cap 40" ersetzt die 60
  aus dem Auftrag). `validateBoot` wird durch die Phasentabelle kürzer, nicht länger.
- Neue Dateien unter 300 Zeilen: `boot-rule.ts`, `boot-report.ts`, `boot-phases.ts`,
  `boot-rules.ts` (Index), Generator.
- `validateNavBootSubset` (Test-Stack) bekommt denselben Collector.

## 4. Verbraucher

Stand: FW `origin/main`, kumiko-studio `origin/main`, übrige Repos Haupt-Checkout, alle am
2026-10-28.

### Framework

| Stelle | Befund | Folge |
|---|---|---|
| Tests, die `validateBoot`, `createApp` oder `validateNavBootSubset` aufrufen | 104 Dateien; rund 820 `toThrow(`-Asserts mit Muster (459 einzeilig `toThrow(/`, 363 mehrzeilig, 3 String), 30 `rejects.toThrow(`, 471 `not.toThrow()` | Teilstring-Match bleibt grün, solange jede Meldung wörtlich enthalten ist |
| davon `engine/boot-validator/__tests__/` | 26 Dateien, 136 `toThrow` mit Argument | wie oben |
| exakte Meldungs-Gleichheit, Snapshots, `^`/`$`-verankerte Regexe, `not.toThrow(/x/)` | 0 Fundstellen | kein Bruch |
| `expectErrorIncludes` (`testing/src/helpers/expect-error.ts`) | 0 Boot-Tests nutzen es | keiner |
| `schema-cli/validate-command.ts` | eine `✗ boot:`-Zeile, `describeThrown` gibt nur `e.message` | wird angepasst (S3) |
| Integrationstests der CLI | `framework/src/__tests__/schema-cli.integration.test.ts`, `schema-cli-validate-boot-options.test.ts`, `cli/src/commands/__tests__/check.test.ts` | Ausgabeformat prüfen |
| dev-server-Tests | `run-dev-app-boot-validation.test.ts`, `scaffold-*.test.ts`, `compose-stacks.test.ts`, `walkthrough.integration.test.ts` | Teilstring, sollten grün bleiben |

Risiko bei der späteren ID-Migration: Ein Regex, der heute über den Teil „was ist falsch" und
den Fix-Satz hinweg matcht, bricht, wenn die Migration den Fix-Satz in `fix` auslagert. Jede
Migrations-S fährt deshalb die Tests ihrer Datei.

### Studio-Prüfloop (kumiko-studio)

`scripts/designer-measure/check-runner.ts`, `parseFindings`:

- `FAILURE_LINE = /^\s*(✗|error:|\(fail\)|\d+ fail$)/` behält nur Zeilen mit `✗`. Eine
  mehrzeilige Gesamtmeldung unter einer einzigen `✗ boot:`-Zeile fiele auf einen Befund
  zusammen.
- `MAX_FINDING_CHARS = 300` schneidet ab; Meldung (1) aus Unterweisung ist schon allein länger.
- `MAX_FINDINGS = 20`.

Folge: Ohne S3 (eine `✗`-Zeile pro Verstoß) würde das Sammeln im Studio nicht ankommen. Mit
S3 funktioniert der bestehende Parser ohne Änderung, schneidet aber weiter bei 300 Zeichen ab;
eine Studio-S stellt auf `--json` um. `src/features/publish/release/build-phase.ts:193` führt
`schema-validate` nur als Schritt aus und zeigt den Log-Tail, parst nichts. Der Fake-Provisioner
in `e2e/_support/fake-provisioner.ts` simuliert nur `failedStep: "schema-validate"`.

### Apps und Enterprise

Produktivcode reicht überall nur `validateBootOptions` durch (`bin/main.ts`, `bin/server.ts`,
solon zusätzlich `bin/worker.ts`) und parst keinen Fehlertext.

| Repo | Testdateien mit validateBoot | Text-Asserts auf Boot-Meldungen | Folge |
|---|---|---|---|
| kumiko-enterprise | 6 | `ai-agent` boot-checks: `/has user-subject fields \(payload, authorId\)/`, `/ai-agent-permission/`; `prompt-store`: `/has user-subject fields \(authorId\)/` | bootCheck-Text bleibt, grün |
| kumiko-studio | 3 + Demo `wartung` | `pattern-storage`, `ai-conversation`: `/has user-subject fields \(...\)/`; Demo `not.toThrow` | grün |
| publicstatus | 1 | nur `not.toThrow` | grün |
| money-horse | 2 | `createCreditFeature`-Throws (Schicht 0, unberührt); `console.warn`-Spy auf blockDelete-Warnung | grün, Warnungen unverändert |
| offlot-app | 3 | `console.warn`-Filter: `security-baseline.test.ts`, `app-shell-nav-sections.test.ts` (`"[kumiko:boot] Nav entry"`) | Warnungstext darf sich nicht ändern |
| phronexsis | 6 | `simulation`: `/targets unknown feature "forecasting"/` | P1-Meldung, grün |
| solon | 3 | `nav-reachability.test.ts` filtert `"[kumiko:boot] Nav entry"` mit Canary-Test | Warnungstext darf sich nicht ändern |
| show-pony | 0 | keine | keine |
| kumiko-platform | 0 | keine | keine |

`r.bootCheck` in Consumern: nur Enterprise (`ai-agent/src/feature.ts:210`, `:213`,
`ai-foundation/src/feature.ts:226`; letzterer mit eigenem `[kumiko:boot]`-Präfix im Text).

Fazit: Wenn die Gesamtmeldung jeden Einzeltext wörtlich enthält und Warnungen unverändert
bleiben, ist kein App-Test über den Meldungstext betroffen. Einschränkung: Die Zusage gilt
innerhalb einer Phase, nicht über den Abbruch nach P1. P1 zieht `validateReferenceFields`,
`validateExtensionUsages`, `validateApiExposureMatching`, `validateParentRefs` und
`validateQueryRefs` vor die übrigen Prüfungen. Hat ein Test-Fixture neben dem erwarteten Fehler
einen versteckten P1-Verstoß, warf es bisher zuerst den erwarteten Fehler und wirft künftig nur
den P1-Abbruch; sein `toThrow(/erwartet/)` wird rot. Der FW-Testlauf in S1 und die App-Messung
zeigen diese Fixtures; sie werden korrigiert, die Phasenreihenfolge bleibt. Gebrochen wird nur die einzeilige Ausgabe von
`kumiko-schema validate`, und die liest nur der Studio-Prüfloop.

## 5. Migration der 526 Throws

Ein reiner Codemod kann keine sinnvollen IDs und Fix-Texte erfinden. Automatisch erzeugte IDs
(`entity-handler-17`) wären nicht stabil, weil sie sich mit jeder Umsortierung verschieben, und
wertlos für Agenten. Deshalb:

- **Runde 1 braucht keine Migration für das Sammeln.** Alte Throws werden als
  `unclassified/<check>` gesammelt (Abschnitt 3).
- **In Runde 1 registriert** werden die Regeln, die die Messung gezeigt hat, plus die Dateien,
  die dafür ohnehin angefasst werden: `pii-retention.ts` (20), `entity-list-screens.ts` (6),
  `i18n-keys.ts` (4), `card-meta-overflow.ts` (1), `boot-check.ts` (1), `api-ext.ts` (5),
  `user-data-rights/boot-checks.ts` (3). Zusammen 40 Stellen. Dazu die Grenzen pro Regel in
  genau diesen Dateien.
- **Danach schrittweise** pro Datei-Gruppe, jede Gruppe eine S. Der Ausdruck hinter `throw`
  wird mechanisch ersetzt, Fix-Text und ID schreibt der coder pro Stelle. Grenzen pro Regel
  kommen dazu, wo eine Funktion mehrere unabhängige Prüfungen hintereinander hat. Die
  Baseline des Ratchet sinkt mit jeder S.
- Die ID-Migration ändert kein Verhalten und keine Meldung. Sie muss deshalb nicht in die
  fw-next-Lane und kann mit normalen Releases ausgeliefert werden.

Reihenfolge der Migrationsgruppen nach Nutzen für Agenten (häufig getroffene Bereiche zuerst):
Screens (`screens-*.ts`, `screens-kind-*.ts`, ca. 230), Felder und Entities
(`entity-handler.ts`, `form-derivations.ts`, ca. 105), Listen und Tabellen (`list-*.ts`,
`projection-list-screens.ts`, `bundled-lists-table.ts`, ca. 75), Config, Access, Ownership,
Nav, Rest (ca. 75).

Nicht in dieser Runde: Schicht 0 (Definition, ca. 119), Schicht 1 (createApp, 9) und
Schicht 3 (Registry, ca. 80). Schicht 0 ist der größte Rest: ein Fehler in `r.nav` beendet
schon den Import von `kumiko/schema.ts`. Sammeln hieße, dass der Registrar Verstöße am
FeatureDefinition ablegt statt zu werfen und validateBoot sie in P1 meldet. Das ist eine eigene
Runde (Abschnitt 6, Folgerunde).

## 6. Schnitt

Runde 1 läuft als fw-next-Runde, weil sie das Verhalten jedes Boots ändert: auf `main` mergen
ohne Release, alle Apps lokal dagegen messen, ein Release am Ende.

**Runde 1 (freigegeben 2026-10-28)**

| S | Repo | Inhalt | Abhängig von |
|---|---|---|---|
| S1 | FW | `boot-rule.ts`, `boot-report.ts`, `boot-phases.ts`; Grenzen und Phasen in `validateBoot` und `validateNavBootSubset`; `unclassified`-Sammeln; Crash-Unterdrückung; ein bootCheck pro Grenze; `BootValidationError` mit `violations`. Tests: Gesamtmeldung enthält jeden Einzeltext, Abbruch nach P1, Paar-Skip, Registry-Grenze, Crash ohne Vorverstoß wird geworfen. Fixtures mit verstecktem P1-Verstoß, die im FW-Lauf rot werden, werden korrigiert | keine |
| S3 | FW | `validate-command.ts`: eine `✗`-Zeile pro Verstoß mit ID und Fix-Zeile, `--json`; `kumiko check` reicht durch; CLI-Tests. Ohne S2 tragen die meisten Verstöße die ID `unclassified/<check>` | S1 |
| Mess | alle Apps | lokal gegen unveröffentlichtes FW: Tests jeder App aus Abschnitt 4, `bun kumiko check` pro App. Erwartung: keine Änderung außer der Ausgabe von `validate` | S1, S3 |
| Release | FW | ein Release nach grüner Messung; Changeset als minor, weil sich die Ausgabe von `kumiko-schema validate` ändert | Mess |

**Spätere Runde**

| S | Repo | Inhalt | Abhängig von |
|---|---|---|---|
| S-Studio | kumiko-studio | `check-runner.ts`: `--json` lesen statt Zeilen-Regex, Kürzung pro Befund auf Meldung, Fix getrennt; Unterweisung erneut messen | Release Runde 1 + Bump |
| S2 | FW | Regeltabellen und zentrale Liste; Export `bootRuleError`/Typen aus `engine`; Migration der 40 Stellen aus Abschnitt 5 inkl. Grenzen pro Regel (`FIELD_RULES`, entityList als Regeltabelle, i18n sammelt alle Keys, bootChecks); Test auf eindeutige IDs | Runde 1 |
| S4 | FW | Generator `agents/boot-rules.md`, Eintrag in `AGENTS.md`; Ratchet-Guard mit Baseline | S2 |
| S5 bis S8 | FW | ID-Migration in vier Gruppen (Abschnitt 5), Baseline sinkt; bei 0 Guard löschen | S4 |
| Folgerunde | FW | Schicht 0 (Registrar sammelt), Schicht 1 in validateBoot ziehen, Schicht 3 an den Collector, Warnungen als Regeln | S5 bis S8 |

## 7. Entscheidungen

Am 2026-10-28 von Marc entschieden: E1 bis E8 jeweils wie empfohlen. Die Optionen bleiben als
Begründung stehen.

**E1 Abbruch zwischen Phasen**
- (a) nach jeder Phase mit Verstößen abbrechen: kaum Folgefehler, Unterweisung braucht 2 Läufe.
- (b) nur nach P1 abbrechen, P2 und P3 zusammen, Crashes nach Verstößen unterdrücken, Paar-Skip
  für Wiring/Screens: Unterweisung braucht 1 Lauf, vereinzelte Doppelmeldungen möglich.
- (c) nie abbrechen: maximale Meldungen, Folgefehler aus unaufgelösten Referenzen.
- **Empfehlung (b).** Die bekannten Folgefehler sitzen alle an P1-Kanten oder im Paar
  Wiring/Screens. Zeigt die Messung Rauschen, ist (a) ein Schalter in `boot-phases.ts`.

**E2 Form der Regeldefinition**
- (a) `defineBootRule({ ... })` pro Regel (Vorschlag aus der Session).
- (b) typisierte Tabelle pro Datei mit `as const satisfies BootRuleTable` plus zentrale Liste.
- **Empfehlung (b).** Gleiche Typsicherheit ohne Wrapper, passt zur Regeltabellen-Linie aus dem
  Eintrag „Complexity cap 40", und der Generator bekommt alle Regeln über einen Import.

**E3 Werfen oder Pushen**
- (a) typisierter Throw (`throw bootRuleError(...)`), gesammelt an Grenzen.
- (b) `report.push(...)` an jeder Stelle, Validatoren laufen selbst weiter.
- **Empfehlung (a).** Kontrollfluss bleibt wie er ist, die Migration ist pro Stelle mechanisch,
  und Grenzen pro Regel geben dieselbe Granularität dort, wo sie gebraucht wird.

**E4 Maschinenlesbare Ausgabe**
- (a) nur Textzeilen, eine `✗`-Zeile pro Verstoß.
- (b) Textzeilen plus `--json`.
- (c) JSON-Datei als Nebenprodukt neben der Textausgabe.
- **Empfehlung (b).** Der Studio-Parser läuft mit (a)-Format sofort weiter und stellt in einer
  eigenen S auf JSON um; eine Datei als Nebenprodukt bräuchte Pfad-Konventionen ohne Gewinn.

**E5 Verweis auf die Regel-Doku**
- (a) relativer Pfad `agents/boot-rules.md#<anker>` in der Meldung (im installierten Paket lesbar).
- (b) URL auf docs.kumiko.rocks.
- (c) kein Verweis, nur die ID.
- **Empfehlung (a).** Die Datei liegt versionsgleich in `node_modules`, Agenten lesen sie dort
  ohnehin; eine Web-URL kann von der installierten Version abweichen und braucht eine
  Doku-Pipeline.

**E6 Regeln aus Enterprise und Apps**
- (a) nur FW und bundled Features in `boot-rules.md`; Enterprise und Apps nutzen
  `bootRuleError` mit eigenen IDs, ohne generierte Doku.
- (b) Generator auch in Enterprise mit eigener `boot-rules.md`.
- **Empfehlung (a)** für diese Runde. Enterprise hat drei bootChecks; (b) lohnt sich erst, wenn
  der Studio-Designer Enterprise-Features verbaut.

**E7 Ratchet**
- (a) Guard mit Baseline pro Datei, gelöscht bei 0.
- (b) kein Guard, Migration nur über die S-Liste.
- (c) FW-Unit-Test, der die Throws zählt.
- **Empfehlung (a).** Ohne Ratchet wachsen neue rohe Throws schneller nach, als S5 bis S8 sie
  abbauen. (c) ist derselbe Guard an einem Ort, an dem ihn niemand als Guard erwartet.

**E8 Kopfzeile bei genau einem Verstoß**
- (a) immer Kopfzeile und Liste.
- (b) bei genau einem Verstoß die alte Einzelmeldung ohne Kopf.
- **Empfehlung (a).** Ein Format für Menschen und Parser; die Teilstring-Asserts bleiben in beiden
  Fällen grün.
