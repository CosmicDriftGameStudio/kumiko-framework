---
status: in-progress
verified: 2026-11-10
next: Stufen 1 bis 3 sind erledigt (FW #4294, #4296, #4297 in 0.419.0, Enterprise #937). Stufe 4 läuft in kumiko-enterprise#938 und im Button-PR im Framework. Danach Stufe 5 mit der Modellmessung.
track: framework
depends: [kumiko-framework:docs/plans/features/document-designer.md]
---

# Vorlagen-Import: Die KI baut eine hochgeladene Vorlage im Content-Editor nach

Marcs Vorgabe (2026-11-09, wörtlich): „ich hätte gerne einen plan den content editor so zu
erweitern das er aus einem bestehenden vorlage über ki die eigenten so anpasst das die
identisch sind / das die leute einfach Ihre hochladen und er designer unseren editor so
steuert das es idetntisch ist“. Dazu: „wir sollten in den editor im dem zug mal noch ein
rand linial machen, dsa man ca sieht wie ies ist“.

Das Ergebnis ist immer eine normale, im Editor änderbare Vorlage. Bei PDFs ist der Maßstab:
Neben dem Original fällt kein Unterschied bei Positionen, Schriften, Farben und
Zeilenumbrüchen auf. Bei Mails ist nur die gleiche Anmutung erreichbar, weil jeder
Mail-Client anders rendert.

Die Reihenfolge folgt daraus, dass die KI nur bauen kann, was der Editor selbst kann. Erst
kommen die Fähigkeiten des Editors, dann der Zugriff der KI, dann ihr Blick auf das
Ergebnis, zuletzt der Import.

## Ist-Stand (gemessen 2026-11-09)

Vorhanden: Der eine Content-Editor (#4215), `patch-draft`, die Vorlagen-Werkzeuge im
Assistenten (kumiko-enterprise#763, #764), Chat-Anhänge für PDF, Bild und DOCX, PNG-Ausgabe
im `puppeteer-service`, Prüfung der Platzhalter beim Speichern.

| Lücke | Stelle |
|---|---|
| Keine Textfarbe und keine Schriftart, von der Größe gibt es nur `small` | `template-resolver/web/document-schema.ts` |
| PDF-Grundschrift fest auf Helvetica 10,5 pt, Kopf und Fuß auf 9 px | `renderer-puppeteer-client/src/document-pdf.ts:75`, `:337` |
| Keine Bereiche mit fester Position, ein DIN-5008-Adressfeld geht nicht | Designer-Plan: „bewusst nicht in v1“ |
| Die Papieransicht ist nicht maßhaltig, der Briefkopf nutzt `px-[8%]` statt der Ränder in mm | `document-designer/src/web/page-canvas.tsx` |
| Kein Lineal in der Papieransicht | `page-canvas.tsx`, `layout-editor-paper.tsx` |
| `insertBlock` kann keine Tabellen und keine Formatierung | `template-resolver/document-ops.ts` |
| Höchstens 50 Ops pro Patch | `MAX_DOCUMENT_OPS` |
| `patch-draft` nimmt nur `mail` und `document-pdf`, Kopf und Fuß liegen in den Layouts | `DOCUMENT_HTML_KINDS` |
| Jeder Patch braucht eine Freigabe | `ai-agent/src/approval-requirement.ts` |
| `tool_result` trägt nur Text, die KI sieht ihr Ergebnis nicht | `ai-foundation/src/providers/types.ts` |
| `openai-compat` kann keine PDF-Blöcke, dort kommt vom PDF nur der Text an (solon) | `ai-provider-openai-compat/src/openai-compat.ts` |
| PDF zu Bild gibt es nicht, Chromium läuft ohne JS | `apps/puppeteer-service` |
| Der Mandant kennt nur den Firmennamen, Anschrift, Bank und Register stehen als fester Text im Layout | `tenant/feature.ts` (`companyName`), `template-validation.ts` (`SYSTEM_PLACEHOLDERS`) |
| `imprint` und `signature` werden im PDF angeboten, kommen dort aber immer leer heraus | `renderer-puppeteer-client/src/document-pdf.ts:530` |

## Entscheidungen

- **Positionierte Bereiche (Marc, 2026-11-09).** Nur im PDF. Neuer Knoten `documentFrame` mit x, y, Breite und Höhe in mm, gemessen von der linken oberen Papierecke. Im Dokument liegt er als HTML mit data-Attributen wie die übrigen Knoten. Mehrspaltige Teile laufen über randlose Tabellen, ein eigener Spalten-Block entfällt.
- **Schriftkatalog (Marc, 2026-11-09).** Feste Liste mit maßgleichen Ersatzschriften, damit die Zeilenumbrüche stimmen. Arial, Times New Roman und Courier New deckt das schon installierte `fonts-liberation` ab, für Calibri und Cambria kommen Carlito und Caladea ins Image. Der Editor lädt die passenden Schnitte zur Build-Zeit über `@fontsource` (Root-Entscheidung 2026-09-22), nur im Editor-Chunk. Eigene Schriftdateien der Kunden kommen wegen der Lizenzfragen später. In Mails bleiben nur Web-sichere Schriften.
- **Farben als Hex-Wert**, geprüft mit dem vorhandenen `isSafeHexColor`. Eine feste Palette könnte das Original nicht treffen. Schriftgrößen und Abstände in pt aus einer festen Liste.
- **Lineal (Marc, 2026-11-09).** Nur Anzeige, nur auf dem Papier von PDF-Vorlagen und PDF-Layouts. Ränder ändert weiter das Einstellungsfeld.
- **Kein rohes HTML von der KI.** `replaceBody` nimmt eine strukturierte Blockliste, die dieselbe Prüfung wie alle Ops durchläuft.
- **Layouts:** Die KI legt immer ein neues Layout an und setzt es über `layoutSlug`. Ein bestehendes Layout nutzen auch andere Vorlagen.
- **Der gemeinsame Look liegt im Layout (Marc, 2026-11-09: „das man die vorlage dann auch auf verschiedene template übertragen kann, wenn man mehrere hat das sie gleich werden“).** Kopf, Fuß, Signatur, Ränder, Grundschrift, Farben und Tabellenstil gehören dem Layout, die Vorlage erbt sie und speichert nur Abweichungen. Der Text und die Platzhalter jeder Vorlage bleiben beim Übertragen unangetastet.
- **Übertragen geht auf zwei Wegen.** „Alle Vorlagen“ speichert das Layout als Standard-Layout des Mandanten (Config `defaultPdfLayoutSlug`, ohne Eintrag gilt `DEFAULT_PDF_LAYOUT_SLUG`). Vorlagen ohne eigenes Layout folgen ohne Kopie, System-Vorlagen bekommen also weiter Textupdates, und neue Vorlagen sehen gleich aus. „Einzelne Vorlagen“ setzt `layoutSlug` als Entwurf je Vorlage und Sprache. Bei einer System-Vorlage entsteht dabei eine Mandanten-Fassung, die spätere Textupdates nicht mehr bekommt, das sagt der Dialog vorher. Übertragen gibt es in Stufe 1 nur für PDF-Layouts auf PDF-Vorlagen, wie im Entwurf. Mail-Layouts bleiben, wie sie sind.
- **Adressfeld als Baustein (Marc, 2026-11-09: „so ein standard adress ding wäre glaube ganz gut“).** Ein neues Menü „Baustein“ in der Leiste fügt das Adressfeld als vorbelegten `documentFrame` ein, ein eigener Knotentyp entfällt. Es sitzt in der Vorlage und nicht im Layout, weil der Empfänger ein Platzhalter der jeweiligen Vorlage ist. Die Lage ist wählbar: DIN 5008 Form A (27 mm von oben), Form B (45 mm) oder frei. Das Feld misst 85 × 45 mm und beginnt 20 mm vom linken Rand. Die Absenderzeile kommt aus den Firmendaten.
- **Fußzeile einmal festlegen (Marc, 2026-11-09: „wenn ich immer im footer x+y+z haben will“).** Der Fuß gehört schon heute zum Layout und gilt für jede Vorlage damit. Neu sind Spalten als Baustein (randlose Tabelle), Schriftgröße und Firmendaten als Platzhalter statt festem Text. Eine eigene Auswahlmaske für den Fuß entfällt, Platzhalter zieht man wie alle anderen in die Spalten.
- **Firmendaten sind Mandanten-Einstellungen (Abnahme der Boards durch Marc, 2026-11-09).** Anschrift, Telefon, E-Mail, Website, Handelsregister, USt-ID, Geschäftsführung, Bank, IBAN und BIC. Sie entstehen als Config-Keys mit `mask`, der Screen im Settings-Hub ergibt sich daraus, und werden in Vorlagen und Layouts als System-Platzhalter nutzbar. Die Editor-Leiste zeigt sie mit ihren Werten und meldet leere Werte vor dem Veröffentlichen. Bankdaten, die je Objekt abweichen, bleiben Platzhalter der Vorlage.
- **Rechte (Marc, 2026-11-09).** Hochladen und Übertragen darf, wer die Vorlage auch bearbeiten darf. Es gilt derselbe Gate wie bei `patch-draft` (`refuseTemplateEdit`, `tenantEditable`), eine neue Rolle gibt es nicht. Soll ein TenantAdmin den Look setzen können, muss die App auch das Layout freischalten.
- **`patch-draft` wird `risk: low`, `effect: proposal`.** Es ändert nur einen Entwurf. Veröffentlichen bleibt ein eigener Schritt mit Freigabe.
- **Seitenbilder für alle Provider.** Der Upload geht immer als PNG pro Seite ans Modell. Das Vergleichsbild kommt als eigener User-Turn, der Provider-Vertrag bleibt unverändert.
- **Upload in v1:** PDF, PNG und JPG. Bei Word kommt der Hinweis, die Datei als PDF zu speichern. Direkter Import bräuchte LibreOffice im Image.
- **Verworfen: das Original als PDF-Hintergrund.** Das wäre pixelgleich, im Editor aber nicht änderbar.
- **Barcodes (Marc, 2026-11-09)** werden nicht nachgebaut. Der Maßstab sind Standard-Dokumente: Brief und Rechnung.

## Beispielvorlagen

Festgelegt am 2026-11-09. Sie sind die Abnahme für Stufe 1 und für die Läufe gegen das echte Modell.

| Vorlage | Prüft |
|---|---|
| Vereinsrechnung, digital, Logo oben rechts | Absenderzeile, Adressfeld, Infoblock, Positionstabelle mit mehrzeiligen Beschreibungen, Summen, Fußzeile |
| Steuerbescheinigung einer Bank, digital, 2 Seiten | Adressfeld und Absenderblock in mm, Courier im Text neben serifenloser Fußzeile, Seitenzahl |
| Werkstattrechnung, Scan | Grafiken bis an den Papierrand oben und unten, Fahrzeugdaten als Tabelle, Umgang mit Scans |

Die Originale enthalten echte Namen, Adressen und Bankdaten und bleiben außerhalb des Repos. Tests im Repo nutzen anonymisierte Nachbauten.

## Stufen

### Stufe 1: Editor und PDF-Ausgabe können es (Framework)

Erledigt: PR #4294 und #4296, gemergt am 2026-11-10.

- Dokumentmodell, Sanitizer und Toolbar: Textfarbe, Schriftart, Größe in pt, Abstände und Zeilenhöhe. Tabellen mit Spaltenbreiten, Rahmen an oder aus, Zellfarbe.
- `documentFrame` in `PDF_DOCUMENT_BLOCKS`, im Editor an der echten Position gezeichnet, Maße im Einstellungsfeld. Nur auf Seite 1, das reicht für Adressfeld und Infoblock.
- Menü „Baustein“ in der Leiste: Adressfeld, Textrahmen, Spalten. Im Layout stehen die Spalten für Kopf und Fuß bereit.
- Firmendaten als Mandanten-Einstellungen und System-Platzhalter, sichtbar in der linken Leiste von Vorlage und Layout.
- `imprint` und `signature` im PDF entweder füllen oder aus dem Angebot für PDF-Vorlagen und PDF-Layouts nehmen.
- Meta am `pdf-layout` (heute leer, `layout-source.query.ts`): Ränder, Grundschrift, Größe, Farben, Tabellenstil. Puppeteer-Render, Kopf und Fuß lesen sie, Werte an der Vorlage gehen vor.
- Übertragen ohne KI, also auch ohne Enterprise: Im Layout-Editor unter „Wird verwendet von“ die Aktion „Auf weitere Vorlagen anwenden“ mit den Wegen „Alle“ und „Einzelne“, dazu ein Write-Handler, der pro Vorlage das Bearbeitungsrecht prüft. Veröffentlichen läuft gesammelt in einem Schritt, die Prüfung auf Pflicht-Platzhalter bleibt je Vorlage.
- `fonts-crosextra-carlito` und `fonts-crosextra-caladea` im Image des `puppeteer-service`.
- Papieransicht maßhaltig: Briefkopf und Seitenränder in mm aus dem Meta.
- Lineal oben und links in `page-canvas.tsx` und im PDF-Fall von `layout-editor-paper.tsx`: Striche pro cm, Zahlen in cm, die Ränder farbig abgesetzt. Nur CSS und in Prozent der Seitenbreite, weil die Seite in schmalen Spalten schrumpft.
- Bilder bis an den Papierrand für Kopf und Fuß im PDF-Layout.
- In Chromium gemessen (2026-11-09): Kopf und Fuß laufen bis an den Papierrand, wenn `#header` und `#footer` das eingebaute Padding von etwa 4 mm verlieren. Sie stehen dann auf jeder Seite. Ein Rahmen im Text wird an der Randbox abgeschnitten, auch mit negativem Versatz. `@page:first{margin-top:…}` senkt den oberen Rand nur auf Seite 1, Fuß und Seite 2 bleiben richtig. Deshalb setzt der Renderer den oberen Rand von Seite 1 auf die Oberkante des höchsten Rahmens, wenn sie über dem Rand liegt (Adressfeld Form A bei 27 mm unter einem Kopfrand von 30 mm). Links und rechts bleibt ein Rahmen innerhalb der Ränder. Ein Briefkopf nur auf Seite 1 ist ein Rahmen und geht nach oben bis an den Papierrand, seitlich nur bis an die Ränder.
- Vorbelegung des Adressfelds: Form A 27 mm und Form B 45 mm von oben, 20 mm von links, 85 × 45 mm. Der Normtext von DIN 5008 ist nicht frei zugänglich, die Werte stammen aus Sekundärquellen, die sich teilweise widersprechen (einzelne nennen 32 und 50 mm). Alle Maße bleiben im Einstellungsfeld änderbar.

Abnahme ohne KI: Die Beispielvorlagen lassen sich von Hand im Editor nachbauen, das PDF liegt neben dem Original. Ein Layout auf zwei Vorlagen übertragen ergibt gleichen Kopf, Fuß und gleiche Schrift bei unverändertem Text. Was so nicht gleich wird, wird vor Stufe 2 gefixt oder als Grenze festgehalten. Das Entwurfs-Board für Leiste, Adressfeld, Lineal, Fußzeile und Übertragen hat Marc am 2026-11-09 abgenommen.

### Stufe 2: Die KI kommt an alles heran (Framework)

Erledigt in #4297 (0.419.0): `patch-draft` und `document-blocks` nehmen Runs, Listen, Tabellen mit Wiederholzeile, Rahmen und die Ops `replaceBody` und `formatBlock` an, dazu `kind: pdf-layout` mit `region`, und `create-layout` legt ein neues Layout an.

- Ops: Tabelle mit Wiederholzeile, Formatierung, `documentFrame`, `replaceBody`.
- Neues Layout anlegen und befüllen, unter denselben Rechten wie `patch-draft`.
- `agent: { risk: "low", effect: "proposal" }` auf `patch-draft`.
- Eigene Layouts der Mandanten: `create-layout` legt sie unter dem Präfix `tenant-layout-` an. Ein Mandant darf sie bearbeiten, veröffentlichen und nutzen, sobald er irgendeine PDF-Vorlage bearbeiten darf. System-Layouts dürfen das Präfix nicht tragen (`reserved_layout_slug`).

### Stufe 3: Die KI sieht das Ergebnis (Framework, Enterprise)

Erledigt: `POST /rasterize` im `puppeteer-service` (poppler in Image und CI), `rasterizePdf` und `AGENT_IMAGES_RESULT_KEY` im Client, die Query `preview-png` mit `agentImages` (#4297). Im `ai-agent` bleibt pro Tool das letzte Bild-Set im Request (kumiko-enterprise#937).

- `puppeteer-service`: PDF zu PNG und eingebettete Bilder ausgeben (`pdftoppm`, `pdfimages`), mit Grenzen für Seiten und Größe. Hochgeladene PDFs sind fremde Daten und bleiben in diesem Dienst.
- Query für den Entwurf als PNG je Seite, über denselben Weg wie das Original.
- `ai-agent`: Bilder als eigener User-Turn, in der Historie bleibt nur das letzte Paar.

### Stufe 4: Der Import (Enterprise, Framework)

- Fähigkeits-Vorprüfung: Vor dem Start prüft der Ablauf, ob das gewählte Modell Tool-Use und Bildeingabe kann (`kumiko-enterprise/packages/ai-provider-openai-compat/src/capabilities.ts`). Fehlt eines von beiden, kommt eine klare Meldung, welches Modell was nicht kann, statt eines Laufs, der mitten drin scheitert.
- Ablauf: Vorlage finden, Platzhalter lesen, Upload lesen, Werte den Platzhaltern zuordnen, Entwurf bauen, rendern, vergleichen, höchstens drei Korrekturrunden.
- Logo aus den eingebetteten Bildern des PDFs als Ressource, sonst aus dem Branding. Bei einem Scan ist die ganze Seite ein Bild, dort kommt das Logo aus einem Zuschnitt des Seitenbilds oder aus einem eigenen Upload.
- Die KI legt alles Gemeinsame ins Layout und formatiert im Text nur Abweichungen, sonst ließe sich der Look nicht übertragen.
- Karte am Ende: Original neben Entwurf, „als fester Text geblieben“, „nicht abbildbar“. Echte Kundendaten aus dem Upload sollen so nicht unbemerkt im Entwurf bleiben. Die KI schließt mit der Query `import-result`. Die Karte lädt Original und Entwurf beim Anzeigen neu, weil der gespeicherte Turn keine Bilder enthält.
- Auf der Karte „Auf weitere Vorlagen anwenden“. Positionen im Text wie das Adressfeld stehen in jeder Vorlage selbst, die gleicht die KI auf Wunsch je Vorlage an, mit demselben Vergleich und einer gemeinsamen Karte.
- Button „Aus Vorlage übernehmen“ im Content-Editor, öffnet den Assistenten mit der Vorlage. Der Editor zeigt ihn nur, wenn die clientAction `ai-agent:import-template` registriert ist, das Framework hängt also nicht vom Assistenten ab. Karte und Button nimmt Marc beim Import-Test ab, ein eigenes Board entfällt (2026-11-10).
- Inhalte aus dem Upload sind für die KI fremde Daten. Ohne Freigabe kann sie nur den Entwurf ändern.

### Stufe 5: Rollout

Framework-Release durch Marc, Bump in der ersten App, Deploy des `puppeteer-service`, Guide und What's new.

Modellmessung vor dem Rollout:

- Drei anonymisierte Nachbauten der Beispielvorlagen, je Vorlage vier Modelle: ein starkes, günstiges Cloud-Modell und zwei selbst gehostete über Ollama oder vLLM.
- Höchstens drei Korrekturrunden je Lauf. Bewertet werden der Bildvergleich mit dem Original, die Zahl der Runden und die Kosten.
- Marc bekommt vor dem Lauf eine Kostenschätzung und gibt sie frei.
- Ergebnis ist eine Tabelle in der Doku „welche Modelle gehen“ und ein dev.to-Artikel dazu.

## Tests

- Stufe 1 und 2: Integrationstests über den echten Stack für Ops, Sanitizer und PDF-Ausgabe, dazu eine Recipe unter `samples/recipes/`.
- Stufe 4: Ablauf mit Mock-Provider. Läufe gegen das echte Modell einmal pro Stufe, gegen die Beispielvorlagen, mit Kostenrahmen vorab.

## Offen

- Die erste App und eine Mail-Beispielvorlage, die erst der Mail-Teil in Stufe 4 braucht.
