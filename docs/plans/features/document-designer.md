---
status: in-progress
verified: 2026-10-15
issue: kumiko-platform#757
next: Phase 0 im Framework (kumiko-framework#3688, #3689, #3690, #3691, #3692), danach Release und App-Bumps.
track: framework
depends: [kumiko-framework:docs/plans/features/ui-design-refresh.md]
---

# Document Designer: Mail- und PDF-Vorlagen im Editor, pro Scope

Mails und PDFs sollen Admins im Browser gestalten können, mit Platzhaltern,
Bildern, Anhängen und Layouts. Ein Plattform-Admin pflegt die System-Vorlage,
ein Tenant-Admin kann sie für seinen Mandanten anpassen. Der KI-Assistent soll
dieselben Vorlagen auf Zuruf ändern können.

Entwurf: https://claude.ai/artifact/MtzrjJ4fc3UJJqR5b8CiXV (privat, von Marc am
2026-10-15 abgenommen). Die fünf Boards sind die Quelle für Form und Maße. Bei
Widerspruch zwischen Board und Text gilt das Board.

## Ist-Stand (gemessen 2026-10-15)

Zwei Mail-Modelle, die nichts voneinander wissen:

| Modell | Woher | Wer |
|---|---|---|
| A: Sections-JSON im Code (`renderer-simple`, kind `notification`) | `header`, `subject`, `footer`, `sections` mit `text` und `button`, Branding statisch über `MailBranding` | Framework: auth-email-password (7 Sender), billing-foundation (3), waitlist (2). Apps: offlot 7 Stellen, publicstatus 4 (eigener Render-Pfad über `render-notification-template.ts`), money-horse 2, phronexsis 1 |
| B: Markdown-Dokument aus der DB (`renderer-mail-html`, kind `mail-html`, MJML-Layout) | `template-resolver`, Handlebars, marked, `mjml2html` | nur solon (`reply.write.ts`) |
| Sonderwege | direkter `transport.send` mit Inline-HTML | `user-data-rights` (4 Mails), show-pony (RSVP), `cap-counter` (Callback) |

`badge`, `chips` und `stages` aus `renderer-simple` nutzt kein Prod-Sender,
nur Tests. Die Vereinheitlichung ist damit kleiner als vermutet.

PDFs: money-horse rendert Code-HTML über `renderer-puppeteer-client` und den
`puppeteer-service` (Chromium, JS aus, Egress-Guard). `renderer-pdf` im
Framework baut nur Tabellen-PDFs mit pdf-lib und kann kein HTML.

Weitere Lücken:

- `EmailMessage` kennt weder Anhänge noch Inline-Bilder (CID). nodemailer könnte beides.
- `delivery.render` speichert das Ergebnis im Job-Payload des `delivery.send`-Jobs. Anhänge müssen deshalb als Referenz mitgehen, die Bytes entstehen erst im Send-Job.
- Branding liegt doppelt: `MailBranding` statisch im App-Code, `BrandingTokens` pro Tenant (`page-render/branding.ts`).
- `template-resource` hat kein Meta-Feld (Betreff, Seitenformat, Ränder, Dateiname). `linkedResources` wird nie geschrieben.
- Der Editor (`renderer-web/src/app/tiptap-editor.tsx`, tiptap v3) kennt nur Text, Formatierung und Variablen-Chips. `ContentEditorFormat` ist `plain | rich | markdown`.
- Cross-Tenant `publish`/`archive` für den System-Admin fehlt im template-resolver.
- publicstatus zielt auf den template-resolver, mountet ihn aber nur in Tests.
- Der Name `designer` ist im Enterprise-Repo belegt (Feature-Config-Editor mit KI-Chat).

Der Plan `content-foundation.md` (kumiko-framework#1770, geschlossen) hat die
Entity, die Collections und den Editor mit Chips gebaut. Seine offene Phase 4
(solon-Adoption) geht in diesem Plan auf.

## Entwurf

Fünf Boards, Mandant „Nordlicht Immobilien GmbH“:

| Board | Inhalt | Umsetzung |
|---|---|---|
| Übersicht | eine Liste für Mail, PDF und Layouts; Spalten Slug, Art, Herkunft (System oder Tenant-Anpassung), Sprachen als Kästchen, Status mit Version, „Verwendet von“ aus der Feature-Registrierung | Framework |
| Mail-Vorlage bearbeiten | links Platzhalter mit Typ, Pflicht und Verwendung plus Ressourcen; Mitte Betreff, Vorschautext, Inhalt mit Chips und Blöcken (Bild, Button, Wiederholung, Trenner); rechts Layout, Absender, Kategorie, Anhänge, Verwendung, Versionen; Herkunfts-Leiste mit „Unterschied“ und „Zurücksetzen“; Sprachwechsel mit „aus de kopieren“; Validierung unten sperrt „Veröffentlichen“ | Framework |
| Mail-Vorschau und Test | serverseitig gerendert, Beispielwerte aus dem Schema, HTML oder Nur-Text, Desktop oder 375 px, Test-Mail an die eigene Adresse mit [TEST]-Präfix, Prüfliste (CID, Textfassung, Größe) | Framework; „Datensatz wählen“ Enterprise |
| PDF-Vorlage (System) | A4-Seite mit Rand, Kopf und Fuß aus dem Layout, Wiederholung mit „Kopfzeile wiederholen“, Seitenumbruch; rechts Seitenformat, Ränder, Dateiname, PDF-Metadaten, Ablage mit Vorlagen-Version; Plattform-Sicht zeigt, wie viele Mandanten eigene Fassungen haben; „Als Bundle exportieren“ | Framework (Puppeteer-Service) |
| Layout und Branding | Branding-Tokens des Mandanten als Quelle, Slot „Inhalt der Vorlage“, Kopf, Signatur, Fuß; Umschalter Mail-Layout / Briefpapier; MJML-Quelle nur für Plattform-Admins; „Wird verwendet von“ | Framework |

## Entscheidungen

- **Ein Mail-Modell.** Jede Mail ist Slug plus Variablen, der Inhalt kommt immer aus einer Vorlage in der DB. Features seeden ihre Default-Vorlagen mit `seedSystemTemplate` und `ifExists: "update"`. Ein kind `mail` ersetzt `notification` und `mail-html`. Sections-JSON und `MailBranding` werden entfernt.
- **Dokumentmodell.** Kanonisch HTML mit data-Attributen (`data-variable`, `data-resource`, `data-each`, `data-page-break`), tiptap-JSON nur im Editor. Serverseitig läuft `@tiptap/html` als Schema-Sanitizer: nur bekannte Knoten überleben.
- **Platzhalter.** Typisiertes Schema (Text, Link, Geld, Datum, Liste) mit Label, Beispiel und Pflicht, deklariert vom Feature. Fester Helper-Satz (each, if, Geld und Datum nach tenant-settings). Unbekannte Platzhalter werden beim Speichern abgelehnt, fehlende Pflicht-Platzhalter sperren das Veröffentlichen. Systemweite Platzhalter (Mandantenname, Logo, Signatur, Impressum, Abmeldelink, Seite/Seiten) brauchen keine Deklaration.
- **Ressourcen.** Upload über file-foundation, Referenz in `linkedResources`. Mail bettet Bilder als CID ein, PDF als Data-URI. Ein Attachment-Typ für Inline-Bild, Datei und „Anhang aus PDF-Vorlage“ (Bytes entstehen im Send-Job). Größen-Cap und Resize über sharp.
- **Layout und Meta.** `mail-layout` und `pdf-layout` sind eigene Vorlagen mit genau einem Pflicht-Platzhalter „Inhalt“. Meta-JSON an `template-resource`, Zod-Schema je kind (Mail: Betreff, Vorschautext, Layout, Kategorie, Absender; PDF: Layout, Seitenformat, Ränder, Dateiname, Metadaten).
- **Branding.** Eine Quelle, die Tenant-Branding-Tokens. Das Layout liest sie, ändert sie nicht.
- **Nachweis.** `RenderResponse` trägt Template-Id und Version. Erzeugte PDFs werden mit beidem abgelegt.
- **Bundle.** Vorlage, Meta und Ressourcen als ein Format für Seeds und Export.
- **Editor.** tiptap v3 mit Extensions (Image, Table, TextAlign, Color, Placeholder) und eigenen Knoten (Variable, Button, Divider, PageBreak, RepeatRow). Neues `ContentEditorFormat: "document"` über die `contentEditors`-Registry. Nicht: GrapesJS, Unlayer, easy-email, BlockNote, Puck, Craft.js, react-pdf, DOCX.
- **Renderer.** Ein Mail-Renderer: `renderer-mail-html` zieht aus Enterprise ins Framework und rendert Dokument plus MJML-Layout (v1: Body roh in `mj-raw`, Komponenten-Mapping später). `renderer-simple` entfällt mit dem Sections-JSON. PDF nur über Puppeteer; `renderer-puppeteer-client` und die App `puppeteer-service` ziehen ebenfalls ins Framework. Ohne laufenden Puppeteer-Service ist die PDF-Maske gesperrt. Kopf und Fuß sind in Chromium auf allen Seiten gleich.
- **Paket und Schnitt (Marc, 2026-10-15).** Der ganze Designer ist public im Framework: Verträge, Renderer, Übersicht, Mail-Editor, PDF-Editor, Layout-Editor mit MJML-Reiter für Plattform-Admins, Vorschau, Test-Mail, Validierung, Bundle. Enterprise behält nur die KI-Bedienung im `ai-agent` und die Vorschau mit echten Datensätzen. Grund: vier Apps laufen ohne Enterprise, und ein Feature, das man auf der Startseite zeigt, verkauft sich hinter Enterprise nicht. Paketname im Framework `document-designer`.
- **Paket-Umzug.** `renderer-mail-html` und `renderer-puppeteer-client` wechseln den Scope von `@cosmicdriftgamestudio` nach `@cosmicdrift`, der `puppeteer-service` wird Framework-App mit öffentlichem Image. Breaking Change mit `changes.json`; money-horse und solon ändern die Importe beim nächsten Bump.

## KI-Bedienung

Der Enterprise-Assistent (`ai-agent`) ruft registrierte Handler als Werkzeuge
auf, mit Risiko, Vorschlag und Konsequenz-Notizen. Für Vorlagen kommen dazu:

- Query-Handler `template.find` und `template.read`: Vorlage per Name, Slug oder „die Registrierungsmail“ finden, Inhalt als Blockliste lesen.
- Write-Handler `template.patch`: strukturierte Operationen auf dem Dokumentmodell (Block einfügen, Text ersetzen, Chip setzen, Ressource verknüpfen), nie rohes HTML. Legt immer einen Entwurf an.
- Vorschau als Konsequenz-Notiz: der Server rendert den Entwurf mit Beispielwerten, die Karte zeigt Betreff und Ausschnitt, `edit` führt in die Maske.
- `template.publish` bleibt ein eigener Schritt mit Konsequenz „irreversible“: Veröffentlichen entscheidet der Nutzer.
- Beispiele: „Mach das Logo in die Registrierungsmail“ (find, read, patch mit Bild-Block aus dem Branding-Logo), „Ändere den Betreff der Rechnungsmail auf …“ (patch meta), „Schick mir eine Test-Mail“ (preview-Handler).

Dieselbe Validierung wie in der Maske: ein Vorschlag, der einen Pflicht-Platzhalter entfernt, wird abgelehnt und als Klartext erklärt.

## Promotion

- Docs-Guide „Mail- und PDF-Vorlagen gestalten“ unter `apps/docs` mit Bildern aus `samples/apps/ui-walkthrough` (Embeds aus getesteten Quellen, keine Illustrationen für Verhalten).
- Eintrag in „What's new“ (`enterprise/ai/whats-new.mdx` für die KI-Bedienung) und auf der Seite „What you get“ für den Editor.
- Artikel nach dev.to-Ablauf (`articles/` in kumiko-platform) nach Phase 2.

## Phasen

| Phase | Inhalt | Repo | Issue |
|---|---|---|---|
| 0 | Paket-Umzug (`renderer-mail-html`, `renderer-puppeteer-client`, `puppeteer-service`) ins Framework. Ein Mail-Modell: kind `mail`, Seeds für alle 11 Framework-Sender und die Sonderwege `user-data-rights` und `cap-counter`, Sections-JSON, `MailBranding` und `renderer-simple` raus. Bump-Checkliste: offlot 7, publicstatus 4 plus eigener Render-Pfad, money-horse 2 plus PDF-Import, phronexsis 1, show-pony 1, solon 1 plus Importe | kumiko-framework, kumiko-enterprise, dann alle Apps | kumiko-framework#3688, #3689, #3690, #3691, #3692; infra#1026; kumiko-enterprise#762; offlot-app#648, publicstatus#611, money-horse#620, phronexsis#674, show-pony#295, solon#568 |
| 1 | Verträge: Meta-JSON mit Zod je kind, Ressourcen-Handler, Attachments in `EmailMessage` und Send-Job, `ContentEditorFormat: "document"`, Cross-Tenant publish/archive, Preview-Contract mit Test-Mail, `RenderResponse` mit Template-Id und Version, Bundle-Format, Branding-Quelle | kumiko-framework | kumiko-framework#3693, #3694, #3695, #3696, #3697 |
| 2 | Masken (Übersicht, Mail-Editor, Vorschau, PDF-Editor, Layout-Editor mit MJML-Reiter) mit Screenshot-Abnahme gegen den Entwurf; PDF-Rendering des Dokumentmodells über Puppeteer | kumiko-framework | kumiko-framework#3698, #3699, #3700, #3701 |
| 3 | KI-Bedienung im `ai-agent`, Vorschau mit echten Datensätzen | kumiko-enterprise | kumiko-enterprise#763, #764 |
| 4 | Consumer: money-horse Tilgungsplan als PDF-Vorlage, solon Antwort-Mail und Vermietungs-PDFs, offlot Kampagnen-Mails; Docs-Guide, What's new, Artikel | Apps, kumiko-platform | money-horse#621, solon#569, offlot-app#649, kumiko-platform#760, #761 |

Später, bewusst nicht in v1: Versionsverlauf mit Wiederherstellen, MJML-Komponenten-Mapping, bedingte Blöcke und Spalten, Tenant-eigene Schriften in Mails, PDF ohne Puppeteer (pdfmake aus demselben Dokumentmodell, anderes Druckbild).

## Abnahme

- Masken entsprechen dem Entwurf, Bild neben Bild, durch Marc.
- Tenant-Admin passt die Rechnungsmail an, bettet das Logo ein, hängt das Rechnungs-PDF an, sendet eine Test-Mail, veröffentlicht. Plattform-Admin sieht, welche Mandanten eigene Fassungen haben.
- Fehlender Pflicht-Platzhalter sperrt „Veröffentlichen“, Entwurf speichern geht.
- PDF mit Briefpapier-Layout, Wiederholzeile aus Listen-Variable und Seitenzahl rendert über Puppeteer und trägt Vorlagen-Id und Version.
- Assistent: „Nimm das Logo in die Registrierungsmail“ liefert Vorschlag mit Vorschau, Übernahme legt einen Entwurf an.
- Kein Prod-Sender baut noch Sections-JSON.
