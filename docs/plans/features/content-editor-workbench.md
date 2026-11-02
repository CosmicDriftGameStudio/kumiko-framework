---
status: in-progress
verified: 2026-11-02
next: Umsetzung aller Abschnitte in einem PR (kumiko-framework#4212), danach FW-Release durch Marc und je ein Bump-Push in publicstatus, money-horse, show-pony.
track: framework
depends: [kumiko-framework:docs/plans/features/document-designer.md]
---

# Ein Content-Editor für alle Inhalte: Bearbeiten und Vorschau

Marcs Vorgabe (2026-11-02, wörtlich): „wir haben hier den pdf-template-editor, der kann
editor und preview. meine idee wäre es das man im edit mehrere format kann und im preview
auch, so das der eine editor überall verwendet werden kann.“

Ziel ist also der eine Editor überall: dieselbe Maske mit Bearbeiten und Vorschau für
Mail- und PDF-Vorlagen, Layouts, managed-pages, Text-Blöcke (Rechtstexte) und
Collections (Signaturen, Snippets, KI-Prompts).

Entwurf, von Marc am 2026-11-02 abgenommen („sieht gut aus“):
<https://claude.ai/artifact/UWFTtx5AUuTPHCQhPWT6Fh>. Die Boards dort sind die Spec für die
Screenshot-Abnahme. Orange „Neu“-Marker zeigen, was gebaut wird. Mail- und PDF-Editor
bleiben, wie sie heute sind.

## Ist-Stand

- Bearbeiten ist schon vereinheitlicht. Seit der Editor-Runde (bundled-features
  0.395.0, #4090, archiviert in `docs/archive/plans/editor-document-round.md`) gibt es nur
  noch die Formate `plain` und `document`. Überall läuft `DocumentContentEditor` (tiptap,
  HTML mit `data-variable`-Knoten) über die Registry `contentEditors`
  (`renderer/src/app/content-editors.tsx`, last-wins pro Client-Plugin).
- Die Maske mit Rahmen gibt es nur im document-designer: `EditorFrame`,
  `EditorInfoBar`, `EditorBody`, `EditorFooter` stehen in
  `document-designer/src/web/editor-shell.tsx` und importieren nur aus `kumiko-renderer`
  plus `editor-header.tsx`, `status-label.ts` und `relative-time.ts`. Der Paket-Index
  exportiert sie nicht, keine App importiert sie.
- Vorschau gibt es an vier Stellen, jede anders gebaut:
  - Mail und PDF: `template-resolver:query:preview` (kind `mail` oder `document-pdf`,
    `slug` Pflicht, nur TenantAdmin/SystemAdmin), PDF als Datei über
    `RendererPuppeteerClientQueries.previewPdf`.
  - Layouts: Compose im Client (`compose-layout.ts`), dann derselbe Weg.
  - managed-pages: keine Vorschau in der Maske. Ausgeliefert wird über
    `createPageBodyRenderer` (`markdown` oder `sanitizeDocument`, mit LRU-Cache).
  - Text-Blöcke und Collections: Umschalter `ContentPreview` unter dem Textfeld
    (`template-resolver/web/content-field.tsx`), ein readOnly-Editor mit
    `substituteVariables`.
- managed-pages und Text-Blöcke bearbeitet man heute in Formular-Masken
  (`managed-pages/screens/page-screens.ts` mit `page-body-section.tsx`,
  `template-resolver/web/text-block-editor.tsx`).

## Entscheidungen

Alle Fragen sind per glasscube entschieden (light und full) und gegen die Premissen aus
`docs/agents/issue-tracker.md` geprüft. Sie werden in dieser Runde nicht neu verhandelt.

### 1. Die Maske zieht in den renderer

Die Shell aus `editor-shell.tsx` zieht als reine Darstellungs-Komponente nach `renderer`.
Status und Herkunft (heute `editor-header.tsx`, `status-label.ts`) werden generische
Props. Alle Editoren nutzen dann dieselbe Maske, auch bundled-features, das
document-designer nicht importieren darf (Paket-Richtung document-designer →
bundled-features → renderer).

- Kumiko-Weg: Masken aus FW-Bausteinen mit gemeinsamer Shell (Workspace-Entscheidung
  2026-10-17).
- Beleg, dass der Umzug klein ist: die Shell importiert nur aus `kumiko-renderer`.

### 2. Bearbeiten bleibt bei `plain` und `document`

Keine neuen Edit-Formate. Das Format kommt aus der Deklaration (Entscheidung 2026-10-27,
Editor-Runde). Der MJML-Reiter bleibt eine Sache des Mail-Layouts.

### 3. Vorschau über eine Registry pro Ziel

Neu im renderer, neben `contentEditors`:

```ts illustration
type PreviewTarget = "pdf" | "mail" | "web" | "text";

type PreviewSubject =
  | { kind: "template"; templateKind: TemplateKind; slug: string; locale: string; meta: unknown }
  | { kind: "layout"; templateKind: TemplateKind; html: string }
  | { kind: "body" };

interface PreviewRendererProps {
  content: string;
  editFormat: ContentEditorFormat;
  variables: Record<string, unknown>;
  subject: PreviewSubject;
}

contentPreviews?: Partial<Record<PreviewTarget, PreviewRenderer>>;
```

- Gleiche last-wins-Semantik wie `contentEditors` in `client-plugin.tsx`.
- Fallback ist `text`: das heutige `ContentPreview`, nur jetzt im Vorschau-Modus der Maske
  statt als Umschalter unter dem Feld.
- Jeder Renderer ruft seinen eigenen Server-Weg mit seiner eigenen Zugriffsregel auf.
- document-designer registriert `mail` und `pdf` (`query:preview`, `previewPdf`, Layout-
  Compose bleibt im Client).
- template-resolver registriert `web` und besitzt die eine Body-Preview-Query
  (`query:body-preview`, TenantAdmin/SystemAdmin, ohne Cache) für den ungespeicherten Stand.
  Sie rendert wie managed-pages und legal-pages mit `renderSafeMarkdown` bzw. dem
  Document-Sanitizer. managed-pages hat weder eine eigene Query noch einen eigenen Renderer;
  `managedPagesClient` mountet denselben Renderer mit, weil eine App die Seiten-Maske ohne
  `textBlocksClient` betreiben kann. Grund: solon und offlot-app mounten legal-pages ohne
  managed-pages, die Rechtstext-Vorschau darf nicht daran hängen.
- Ein Collection-Eintrag im Format `document` zeigt im Vorschau-Modus das gerenderte Ergebnis
  mit eingesetzten Beispielwerten (template-resolver registriert dafür `text`); andere Formate
  bleiben beim Text-Fallback.

Verworfen:

- `query:preview` erweitern: die Query ist nur für Admins. Collections sind auch für TenantMember
  offen, und Nutzer-Inhalte liegen in einer eigenen Tabelle, nicht im Template-Store.
- Jede Stelle bringt ihre eigene Vorschau mit: das dupliziert die Shell-Logik pro Feature
  und ist nicht deklarativ (Premisse Framework-Denke).

### 4. Das Ziel folgt aus der Art

Eine vollständige `Record<EditableTemplateKind, PreviewTarget>` (`previewTargetOfKind`
in `template-resolver/web/constants.ts`), mit
`EditableTemplateKind = Exclude<TemplateKind, "notification" | "image-snapshot">`.
Vollständig heißt: eine neue Art bricht den Typecheck, bis sie ein Ziel hat oder bewusst
ausgeschlossen wird. Die beiden Ausnahmen haben keinen Editor: `notification` ist laut
`constants.ts` stillgelegt und wird nur noch beim Replay gelesen, `image-snapshot`
bekommt fertiges HTML im Request (`renderer-puppeteer-client/src/feature.ts`).

| Art | Ziel | Server-Weg |
|---|---|---|
| `mail` | `mail` | `query:preview` |
| `document-pdf` | `pdf` | `query:preview` + `previewPdf` |
| `mail-layout` | `mail` | Compose im Client, dann `query:preview` |
| `pdf-layout` | `pdf` | Compose im Client, dann `previewPdf` |
| `text-block` | `web` | `query:body-preview` (`renderSafeMarkdown` wie legal-pages), nur Body, ohne `wrapInLayout` |
| `snippet` (alle Collection-Einträge), `ai-prompt` | `text` | keiner, Ersetzung im Client |

managed-pages ist keine Template-Art und läuft nicht über die Map: die Seiten-Maske gibt
der Shell das Ziel `web` direkt mit (Renderer und Query gehören template-resolver). Collections haben eine opake eigene `kind`, ihre
Einträge liegen aber alle unter der Art `snippet` und landen damit bei `text`.

`text-block` bekommt nur `web`, weil sein einziger Consumer legal-pages ist. Ein Feld
`previewTarget` an der Collection kommt erst, wenn ein Consumer Snippets in Mails
einsetzt (YAGNI).

### 5. managed-pages ohne Entwurf und Veröffentlichen

Kein Draft/Publish-Ablauf für Seiten. Der Schalter „Veröffentlicht“ bleibt in der rechten
Spalte, unten steht nur „Speichern“. Der Veröffentlichen-Slot der Shell ist optional.
Metadaten und Body gehen in einem Submit raus (Workspace-Entscheidung 2026-09-21,
Eingaben nie still verlieren).

### 6. solon reply-composer bleibt ohne Maske

Der Antwort-Editor in solon nutzt weiter nur `DocumentContentEditor`, ohne Shell und ohne
Vorschau. Er schickt das HTML unverändert plus `htmlToPlainText`, eine Vorschau zeigt
dort nichts Neues.

## Was entfernt wird

Nach der Workspace-Entscheidung 2026-10-02 ersetzt die neue Maske die alte komplett:

- der `ContentPreview`-Umschalter in `template-resolver/web/content-field.tsx`
- die Formular-Masken für managed-pages (`entityEdit` in `page-screens.ts` mit
  `page-body-section.tsx`), für Text-Blöcke (`text-block-editor.tsx`) und für
  Collection-Einträge

`ContentPreview` selbst bleibt als `text`-Renderer im renderer.

## Abschnitte

1. renderer: Shell umziehen (Status/Herkunft als Props), Registry `contentPreviews`
   mit Typen und `text`-Fallback, Merge in `client-plugin.tsx`. document-designer
   importiert die Shell danach aus dem renderer. Ein Recipe in `samples/recipes/` zeigt
   einen eigenen Preview-Renderer (AGENTS.md: neues FW-Feature braucht ein Recipe).
2. template-resolver: `previewTargetOfKind` als vollständige Map.
3. document-designer: registriert `mail` und `pdf`, Mail-, PDF- und Layout-Editor
   holen ihre Vorschau über die Registry. Sichtbar ändert sich nichts.
4. template-resolver und managed-pages: eine Body-Preview-Query und der `web`-Renderer mit
   Desktop/Mobil 375 px in template-resolver (Zugriff TenantAdmin/SystemAdmin), Seiten-Maske
   in managed-pages auf der Shell, alte Formular-Maske raus.
5. Text-Blöcke und Collections: Maske auf der Shell, `web` für Text-Blöcke, `text` für
   Snippets und KI-Prompts, Umschalter unter dem Feld raus.
6. Abnahme: Screenshots jeder Maske gegen die Boards im Entwurf (Seite bearbeiten,
   Seiten-Vorschau, Rechtstext-Vorschau, Snippet-Vorschau). Erst wenn sie deckungsgleich
   sind, gilt die Runde als fertig.

Marcs Vorgabe (2026-11-02): möglichst wenig Runden und PRs, damit es zügig fertig ist.
Deshalb ist das eine Runde mit einem FW-PR, der alle Abschnitte enthält, keine S-Issues.
Danach ein FW-Release und pro betroffener App ein Bump-Push.

## Betroffene Consumer

- managed-pages: publicstatus, money-horse, show-pony
- legal-pages (Text-Blöcke): alle Apps mit Rechtstexten, dazu kumiko-studio
- Collections: am 2026-11-02 deklariert keine App `contentCollection`, auch die
  Shell-Komponenten, `ContentPreview` und `TextBlockEditor` importiert keine App direkt
  (Suche über alle Repos im Workspace). Vor dem Bump noch einmal messen.
- solon: reply-composer unverändert, bekommt nur den Bump
