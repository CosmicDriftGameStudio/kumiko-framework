---
status: in-progress
verified: 2026-10-17
issue: kumiko-platform#721
evidence: Framework 0.328.0 bis 0.333.0, App-Bumps gemergt, Docs und Marketing in kumiko-platform#759 (zu #722)
next: Solon setzt in analyze-command.write.ts das summary aus kumiko-ai-triage statt categorySummary aus dem Kategorie-Label (Solon-Issue noch anzulegen).
track: framework
depends: []
---

# UI-Design-Refresh: neue Defaults, feste Seitenhöhe, Drawer-Aktion

Die Kumiko-Masken laufen fast unverändert auf den shadcn-Defaults. Am 2026-09-30
hat Marc einen Entwurf freigegeben, der dichter und sachlicher ist und Details
in der Maske zeigt, die heute in den Daten stecken. Dieser Plan beschreibt, was
davon ins Framework kommt, was in Solon, und wie Apps und Doku nachziehen.

Entwurf: https://claude.ai/artifact/6BNqEGJVxgrNBQjQ2CzEV3 (privat). Die Boards
sind die Quelle für Form und Maße. Bei Widerspruch zwischen Board und Text gilt
das Board.

## Stand am 2026-10-17

- Framework: kumiko-framework#3381 mit Release 0.328.0, Befund-Runden in
  #3408, #3409, #3412, #3417, #3421, #3422, #3429, #3430, #3432 und #3436
  (letzte in 0.333.0). Auf schmalen Viewports zeigt die Kopfzeile nur noch
  Icon-Buttons: die primäre Aktion als Icon, alle anderen im „…“-Menü. Ein
  langes Aktions-Label kann den Titel so nicht mehr quetschen. Belege in den
  Docs-Bildern: `samples/apps/styleguide/edit-existing` und
  `samples/apps/workspaces/workspace-dispatch`, jeweils
  `en/default-light/mobile.png`.
- Apps: alle sieben gebumpt und inzwischen weit über 0.331.0. solon#502 wurde
  geschlossen, weil spätere Bumps den Pin überholt haben (Solon steht auf
  0.359.0).
- kumiko-enterprise#658 und #662 sind in kumiko-ai-agent und kumiko-ai-triage
  0.41.0 released. Seitdem liefert `kumiko-ai-triage` ein `summary` pro
  Nachricht.
- Docs-Site, Marketing und die Skill-Zeilen sind in kumiko-platform#759
  gemergt (zu #722, Docs-Pin 0.362.0, Enterprise 0.52.0).
- Offen in Solon: `analyze-command.write.ts` setzt den Zusammenfassungssatz
  noch über `categorySummary` aus dem Kategorie-Label. Der Kommentar dort
  beschreibt den Stand vor kumiko-ai-triage 0.41.0.

## Ist-Stand (gemessen 2026-09-30)

- `renderer-web` hat dunkle Default-Tokens mit Light-Overrides
  (`packages/renderer-web/src/styles.css:56-220`). Die Schrift ist Inter mit
  System-Fallback, Fontdateien liegen nicht im Paket.
- Die Shell hat schon eine feste Höhe (`layout/app-layout.tsx:55`, `h-screen`
  mit `overflow-hidden`). Der Pager der DataTable sitzt aber im Scrollbereich
  (`primitives/index.tsx:1822-1896`) und wandert mit der Zeilenzahl.
- `scrollBody`, `fillHeight`, `stickyActions` und `chromeless` sind Opt-in.
  Keine der sieben Web-Apps setzt eine dieser Props.
- Eine rowAction mit Formular öffnet immer eine eigene Seite.
- `StatusBadge` hat keinen Punkt, die Zeilenhöhe der Tabelle ist 40 px
  (`--kumiko-grid-row-h`).
- Solon-Posteingang: Signale sind reine Icons
  (`inbox-cockpit-screen.tsx:491-512`), Vorschläge sind Kacheln mit
  „+N weitere“ (`handover-checklist.tsx:905-908`). Beim Duplikat-Hinweis kennt
  der Client pro Kandidat nur `id`, `label`, `hint`, und der Server lehnt
  `linkTo` zusammen mit `changes` ab (`decide.write.ts:490`).

## Entwurf

Richtung: Flächen statt Karten, sachlich und dicht. Zehn Boards:

| Board | Inhalt | Umsetzung |
|---|---|---|
| Liste | Tabelle mit abgesenktem Kopf, Zeilen 40 px, fester Fußzeile mit Zählung und Pager | kumiko-framework#3381 |
| Detail mit Reitern | Kopf mit Breadcrumb, Status und Hauptaktion, Kennzahlenband ohne Karten, Reiter mit Zähler | kumiko-framework#3381 |
| Kurzaktion im Drawer | Formular einer rowAction neben der Seite, Kopf und Aktionsleiste fest | kumiko-framework#3381 |
| Formular | Abschnitte mit Überschrift, Aktionsleiste fest unten | kumiko-framework#3381 |
| Wizard | StepBar im neuen Stil, Navigation fest unten | kumiko-framework#3381 |
| Mobile Liste | Zeilen ab 72 px, Fußzeile mit Zählung und Blättern | kumiko-framework#3381 |
| Posteingang | beschriftete Signale, Filter mit Zähler, Lesebereich mit fester Aktionsleiste | solon#488 |
| Nachricht mit Vorschlägen | geordnete Schrittliste mit Fortschritt und Sperrgrund | solon#488 |
| Konflikt klären | Entscheidung „dieselbe Person?“, Vergleich pro Feld | solon#488 |
| KI-Assistent | angedocktes Panel mit Kontextzeile, Vorschlagskarte, Eingabe fest unten | kumiko-enterprise#639 |

### Werte (hell)

| Rolle | Wert |
|---|---|
| Fläche | `#FFFFFF` |
| Seite | `#F3F2EE` |
| abgesenkt | `#F6F5F1` |
| Linie | `#E2E0D9` |
| starke Linie | `#CFCCC3` |
| Zeilenlinie | `#ECEAE4` |
| Rahmen von Bedienelementen | `#908D85` |
| Text | `#1A1C1E` |
| Text 2 | `#474B50` |
| Text 3 | `#5F6368` |
| deaktiviert | `#8A8E93` |
| Status ok | `#E6F2EA` / `#1D5E36` |
| Status bad | `#F9E5E2` / `#9B2C23` |
| Status warn | `#FBF0D9` / `#7A4B00` |
| Status neutral | `#F0EEE8` / `#474B50` |

Schrift: IBM Plex Sans (400, 500, 600) und IBM Plex Mono, als woff2 im Paket.
Radius 6 px, Zahlen mit `tabular-nums`. Kopfzeile 56 px, Toolbar 52 px, Zeile
40 px, feste Fußzeile 44 px. Bedienelemente 32 bis 36 px, auf schmalen
Viewports mindestens 44 px. Status-Badge als Pille mit 6-px-Punkt.

Der Entwurf zeigt nur den hellen Modus. Die dunklen Werte leitet
kumiko-framework#3381 aus denselben Rollen ab, mit Kontrast von mindestens
4,5:1.

## Entscheidungen

- Der Default-Akzent des Frameworks bleibt neutral. Petrol (Solon) und Blau
  (Offlot) aus den Boards sind Marken der Apps und bleiben Overrides in deren
  `src/styles.css`.
- Feste Höhe ist Default für `entityList`, `projectionList`,
  `projectionDetail`, `actionForm` und Wizard. Abschalten pro Screen bleibt
  möglich. Custom-Screens behalten ihr Verhalten und werden beim Bump per
  Screenshot geprüft.
- Die Drawer-Aktion ist eine Angabe an der rowAction im Screen-Schema. Lange
  Formulare bleiben Seiten, bestehende Aktionen öffnen wie bisher.
- Der Versionskonflikt im Framework behält Banner und „Neu laden“. Der
  Feldvergleich aus dem Board „Konflikt klären“ gilt für den Duplikat-Hinweis
  in Solon.
- Der KI-Assistent hat seinen eigenen Plan
  (`docs/archive/plans/ai-assistant-floating-voice-camera.md`). Von hier kommt nur die Optik des
  Panels, als Kommentar an kumiko-enterprise#639.

## Schnitt und Reihenfolge

1. **kumiko-framework#3381**, ein PR: Tokens und Schrift, feste Höhe, Masken,
   Drawer-Aktion, Framework-Doku. Ein PR, weil jeder Merge ein Release ist und
   die Apps nur einmal bumpen sollen.
2. **solon#488**, ein PR, parallel zu 1: Posteingang, Schrittliste, Konflikt
   klären. Läuft auf dem heutigen Framework-Pin. Teil C ändert einen
   Schreibpfad mit Personendaten, deshalb Advisor und Security-Review als
   hartes Gate.
3. Merge von 1 und 2 erst, wenn Marc die Screenshots abgenommen hat.
4. Bump je App auf das Release, mit Vorher-Nachher-Bildern: solon, offlot-app,
   money-horse, publicstatus, phronexsis, show-pony, kumiko-studio,
   kumiko-enterprise. Checkliste in kumiko-platform#721.
5. Docs-Site und Marketing, siehe nächster Abschnitt.

## Doku-Refresh

Bestand gemessen am 2026-09-30. Jeder Teil hängt am PR, der den Stand ändert,
damit Doku und Code nicht auseinanderlaufen.

**Im Framework-PR (kumiko-framework#3381)**

- `packages/renderer-web/src/changes.json` und der generierte
  `docs/reference/migration-guide.md`: was sich für Apps ändert, wie ein Screen
  das alte Scrollverhalten zurückholt.
- Theming-Doku: neue Rollen, Schrift-Token, wie eine App Marke und Schrift
  überschreibt.
- Referenz der Layout-Props mit den neuen Defaults.
- `samples/apps/styleguide`: README und die Seiten, aus denen die
  Abnahme-Screenshots kommen.

**Im Bump-PR jeder App**

- Eingecheckte Screenshots neu erzeugen (`playwright.screenshots.config.ts` in
  offlot-app, money-horse, publicstatus, phronexsis, show-pony,
  kumiko-studio).
- Solon: 70 Handbuch-Bilder unter `docs/handbuch/de/masken/` mit `bun run shots`
  neu erzeugen, danach `bun run handbuch`. Die drei Masken aus solon#488 kommen
  schon mit deren PR.

**In kumiko-platform nach dem Release (kumiko-platform#722)**

- Docs-Site: 50 Seiten binden `<ScreenshotPreview>` ein, die Bilder liegen
  unter `apps/docs/public/screenshots/` und kommen über `tools/docgen` aus den
  Framework-Samples. Nach dem Release neu ziehen.
- Texte mit Theming-Bezug prüfen: `show-pony/02-look-and-feel.mdx`,
  `guides/widgets.mdx`, `quickstart/quickstart.mdx`.
- Marketing: `bun run sync:screenshots` in `apps/marketing` kopiert
  App-Screenshots nach `src/assets/screenshots/`, läuft nach den App-Bumps.
- Marketing-Mockups (`DetailPage.astro`, `*Mockup.astro`) sind
  handgeschriebenes HTML im Look der Framework-Masken. Gegen den neuen Stand
  prüfen und angleichen.

**Agent-Anleitungen**

- `.claude/skills/kumiko-ui-widgets/SKILL.md` im Workspace: Zeile für die
  Drawer-Aktion, Status-Badge mit Punkt, feste Höhe als Default.

## Abnahme

- Jede Framework-Maske liegt als Screenshot im hellen Modus neben dem Board
  vor und ähnelt ihm zu über 90 %. Marc nimmt den Vergleich Bild neben Bild ab.
  Für den dunklen Modus reichen zwei Kontrollbilder (Liste, Detail).
- Der Pager steht bei 3 und bei 300 Zeilen an derselben Stelle.
- Der Prod-Build eines Samples lädt keine Schrift von fremden Hosts.
- Jede App in der Checkliste hat einen Bump-PR mit Vorher-Nachher-Bildern.
- Keine Doku-Seite zeigt mehr den alten Look.
