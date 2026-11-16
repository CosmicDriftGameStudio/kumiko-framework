---
status: in-progress
verified: 2026-11-16
next: Arbeitspakete A1 bis A6 im Dezember 2026 bauen; erster Zug in der ersten Januarwoche 2027
---

# Release-Kanäle: Beta ab Januar 2027, 1.0 als Ziel im Juni 2027

Marc hat am 2026-11-16 entschieden: Kumiko geht ab Januar 2027 von pre-1.0 in eine Beta und
peilt für Juni 2027 eine 1.0 an. Die Flexibilität im eigenen Workspace bleibt erhalten. Wer
von außen auf Kumiko baut, bekommt Brüche nur noch gebündelt, angekündigt und mit Migration.

Extern sind alle außer Marc selbst: fremde Nutzer der öffentlichen Pakete und die
Studio-Kunden, deren Builds ein Package-Set pinnen. Die eigenen Apps wählen ihren Kanal nach
Bedarf: neue Apps laufen auf `next`, stabile Apps mit wenig Anpassungen auf `latest`.

## 1. Ausgangslage

Gemessen am 2026-11-16 aus `git` und den `changes.json` aller Pakete:

| Zeitraum | Versionen | Breaking-Einträge |
| --- | --- | --- |
| 12.10. bis 20.10.2026 | 0.360 bis 0.379 | 66 |
| 20.10. bis 29.10.2026 | 0.380 bis 0.399 | 45 |
| 29.10. bis 12.11.2026 | 0.400 bis 0.419 | 24 |
| 12.11. bis 15.11.2026 | 0.420 bis 0.424 | 2 |

Vom 16.10. bis 15.11.2026 erschienen rund 61 Releases (0.363 bis 0.424), etwa jedes zweite
mit einem Bruch. Die Kurve fällt deutlich: Mit mehr Apps und mehr Live-Systemen sind die
großen Umbauten durch, und Brüche kommen seltener.

Was es schon gibt und weiter trägt:

- Der Version-PR von changesets wird nur von Marc gemergt, nie automatisch.
- Jeder Breaking-Eintrag braucht Migrationstext (`scripts/guard-changes-json.ts`).
- `kumiko-upgrade --apply` fährt Codemods, manuelle Brüche landen in `pendingManual`.
- Die Baseline der öffentlichen Exporte (`.kumiko-public-exports-baseline.json`) hält die
  Oberfläche klein.
- Die fw-next-Lane: Framework-Runden landen ohne Release auf `main`, alle Apps werden
  lokal dagegen grün gemacht, dann kommt ein Release.

## 2. Zielbild ab Januar 2027 (Beta)

### Zwei Kanäle auf npm, ein Branch

- `next`: Jeder Merge auf `main` veröffentlicht einen Canary unter dem dist-tag `next`,
  zum Beispiel `0.425.0-next-<sha>`. Neue Apps zeigen darauf und bekommen jede Änderung
  sofort. Im Repo wird dabei nichts committet.
- `latest`: Alle zwei Wochen fährt ein Zug. Marc mergt den Version-PR, das Release geht
  unter `latest` raus. Stabile Apps, Studio-Kunden und Fremde stehen auf `latest`.
- Der Zug fährt nur, wenn alle eigenen Apps gegen `main` grün sind (die Regel der
  fw-next-Lane). Ist eine App rot, fällt der Zug aus und der nächste fährt zwei Wochen
  später. Teil-Releases gibt es nicht.
- Fester Rhythmus: alle 14 Tage am selben Wochentag, der erste Zug in der ersten
  Januarwoche 2027. Den Wochentag legt Marc beim ersten Zug fest.

### Semver innerhalb von 0.x

- Eine Changeset-Bump `minor` gibt es nur noch für einen Bruch. Fixes und Verbesserungen
  bekommen `patch`.
- Ein Zug ohne Bruch wird damit ein Patch-Release. Weil `^0.X.0` in 0.x nur `0.X.*` zulässt,
  zieht eine Caret-Range alle Züge ohne Bruch automatisch und bleibt vor dem nächsten Bruch
  stehen.
- npm-Ranges schließen Prerelease-Versionen aus. Ein Canary aus `next` landet also nie
  versehentlich bei jemandem auf `latest`.
- Kein Sprung auf 0.500.0: Den müsste man in allen Paketen von Hand setzen, die
  Studio-Package-Sets pinnen exakt, und technisch bringt er nichts. Den Start der Beta
  markieren der Changelog und die Stability-Policy.

### Hotfixes zwischen den Zügen

Nur bei Security-Lücken und Datenverlust. Ablauf: Branch `release/0.X` vom letzten
Release-Tag, Fix mit Changeset per Cherry-Pick, Patch-Release unter `latest`. Der Eintrag in
`changes.json` kommt zurück auf `main`, damit der Weg von `0.X.1` zum nächsten Zug ihn nicht
verliert, und der nächste Zug veröffentlicht den Fix nicht ein zweites Mal. Alles andere
wartet auf den nächsten Zug.

### Weniger Brüche

- Ein Bruch, der sich mechanisch umsetzen lässt, bekommt einen Codemod für
  `kumiko-upgrade --apply`. Das verlangt die Stability-Policy schon heute.
- Framework-Issues mit Bruch prüfen eine Variante ohne Bruch: neue API neben der alten,
  die alte abgekündigt und erst in einem späteren Zug entfernt.
- Issues beschreiben die Release-Notiz schon beim Anlegen (Typ, Titel, Migration, Codemod,
  Doku). Das regelt `docs/agents/issue-tracker.md` im Workspace. So steht die
  Migration fest, bevor Code entsteht, und der Changeset übernimmt sie nur noch.
- Stabilitätsstufen pro Export (`stable`, `beta`, `experimental`) bauen wir vorerst nicht.
  Sie kommen erst, wenn die Breaking-Zahl im Frühjahr 2027 nicht von allein sinkt.

### Messen

Pro Zug wird die Zahl der Breaking-Einträge aus den `changes.json` gezählt und im
Release-Text genannt. Das ist die Grundlage für die 1.0-Entscheidung.

## 3. 1.0 im Juni 2027 als Ziel

Der Termin verschiebt sich, solange nicht alle diese Punkte erfüllt sind:

- Drei Züge hintereinander mit höchstens drei Breaking-Einträgen je Zug.
- Alle eigenen stabilen Apps laufen auf `latest` und waren bei jedem Zug grün.
- Die bestehenden Kriterien der Stability-Policy gelten weiter: Die Request-Pipeline
  (Dispatcher, Event-Store, Registry) ist einen Zyklus ohne Umbau gelaufen, die
  God-File-Refactors aus `docs/plans/` sind durch.

Nach 1.0 bringen die Züge nur noch Fixes, Neues und Abkündigungen mit Warnung und Codemod.
Entfernt wird nur in einem Major, gebündelt höchstens zwei Mal im Jahr. `next` bleibt als
Kanal für die eigenen Apps bestehen.

## 4. Arbeitspakete im Dezember 2026

| # | Paket | Ort | Prüfung |
| --- | --- | --- | --- |
| A1 | `scripts/publish-with-oidc.sh` bekommt einen Tag-Parameter. Heute steht dort fest `--tag latest`, ein Canary-Lauf würde also `latest` verschieben. Default bleibt `latest`, der Canary übergibt `next`. | kumiko-framework | Test, dass ein Canary-Lauf `latest` nicht anfasst |
| A2 | Canary-Job in `ci.yml` bei Push auf `main`: `changeset version --snapshot next` mit `snapshot.useCalculatedVersion` im CI-Checkout, Publish mit Tag `next`. Rescue-Publish, `publish-raced-version-pr.sh`, Renovate-Dispatch und das Warten auf npm laufen nur für den Zug. Nichts wird committet. | kumiko-framework | Probelauf, danach `npm view <paket> dist-tags` |
| A3 | Prerelease-Versionen in den Werkzeugen: `compareVersionsLocal` (`packages/guards/src/guard-public-exports-changelog.ts`) schneidet den Prerelease-Teil ab. `kumiko-upgrade` und der Upgrade-State-Guard müssen `0.X.0-next-<sha>` richtig einordnen, sonst gilt für Apps auf `next` ein Eintrag als erledigt oder offen, obwohl er es nicht ist. | kumiko-framework | Unit-Tests mit Canary-Versionen |
| A4 | Guard Bump gegen Typ: `minor` nur mit einem `breaking`-Eintrag im `kumiko-changes`-Block, sonst `patch`. Erweiterung von `guard-changes-json.ts`. | kumiko-framework | Guard-Tests |
| A5 | Hotfix-Ablauf: Release-Job auch auf `release/*`, Runbook mit Cherry-Pick und Rückführung des `changes.json`-Eintrags auf `main`. | kumiko-framework | Probelauf mit einem Doku-Fix |
| A6 | Kanal der Apps: Renovate folgt per Default `latest`, die stabilen Apps bekommen damit jeden Zug als Bump-PR. Apps auf `next` pinnen die Canary-Version und ziehen sie per `bun add <paket>@next` nach. Framework-Bump-Issues gibt es pro Repo und Zug. Die Builder-Images der Studio-Kunden folgen dem Zug. | infra, Apps | Renovate-Dry-Run, ein Bump-PR pro stabiler App |

In diesem PR bereits erledigt: dieser Plan, die Stability-Policy mit dem Zielbild, der
Status-Abschnitt im README, der Release-Abschnitt in `AGENTS.md` und der Eintrag in
`docs/reference/decisions.md`. Im Workspace-Repo: Release-Notiz in den Issue-Regeln und in
den Vorlagen von `/issue-split` und `/issue-plan`.

## 5. Risiken

- Canary verschiebt `latest`: abgefangen durch A1 und dessen Test.
- Snapshot-Version landet auf `main`: Der Canary-Job darf nicht pushen. A2 prüft, dass
  der Checkout danach verworfen wird.
- Falscher Versionsvergleich bei Apps auf `next`: A3.
- Hotfix doppelt veröffentlicht oder auf `main` vergessen: A5 mit Runbook und Probelauf.
- Zug fällt öfter aus, weil eine App rot ist: Dann bekommen Externe vier Wochen lang
  nichts. Gegenmittel ist die bestehende Regel, App-Ursachen im Framework zu fixen statt
  in der App zu umgehen.

## 6. Nicht-Ziele

- Keine `1.0.0-beta.N`-Versionen. Sie passen schlecht zu Caret-Ranges und Package-Sets.
- Keine Stabilitätsstufen pro Export (siehe oben).
- Keine Langzeit-Branches. Hotfix-Branches leben nur bis zum nächsten Zug.
