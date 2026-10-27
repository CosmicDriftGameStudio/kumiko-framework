---
status: in-progress
verified: 2026-10-27
next: Runde in einem PR auf main mergen (fw-next-Lane, ohne Release); danach Consumer lokal bumpen (solon reply-composer, managed-pages in publicstatus, money-horse, show-pony), Release erst wenn alle Apps grün sind.
---

# Editor-Runde: nur noch `plain` und `document`, managed-pages im Document-Editor

Freigegeben von Marc am 2026-10-27. Die Entscheidungen unten stehen fest und werden
in dieser Runde nicht neu verhandelt.

## Entscheidungen

1. **Zwei Editor-Formate.** `ContentEditorFormat` kennt nur noch `plain` (Textarea mit
   Variablen-Chips) und `document` (DocumentTiptapEditor, speichert HTML im
   document-schema, Variablen als `data-variable`-Nodes). `rich` und `markdown` fallen weg.
   - Ein feature-ast-Codemod stellt Collection-Deklarationen von `rich`/`markdown` auf
     `document` um. Er fasst nur Collections an (`createTemplateResolverFeature({ collections })`
     und `r.contentCollection(...)`), nie das Speicherformat auf Datensätzen, Seeds oder
     Upserts (`html`, `markdown`, `plain`, `mjml`).
   - Alter HTML-Inhalt mit `{{name}}` als Text wird beim Laden in Variablen-Nodes überführt.
     Eine Datenmigration ist nicht nötig, weil keine App `r.contentCollection` deklariert.
   - Default bleibt `plain`. Das Speicherformat einer Collection leitet der Server aus der
     deklarierten Collection ab (`plain` → `plain`, `document` → `html`) und vertraut dem
     Client nicht mehr. Der öffentliche `template-resolver:write:set` behält seinen
     expliziten Default `markdown`, weil Provisionierungs-Aufrufer darauf bauen.
   - `RichContentEditor` und `renderer/src/web/app/tiptap-editor.tsx` werden entfernt. Der
     öffentliche Document-Editor ist `DocumentContentEditor` aus
     `@cosmicdrift/kumiko-bundled-features/template-resolver/web`; dort importiert ihn auch
     solon, ohne Interna eines anderen Features.
2. **managed-pages.** Die Seite bekommt ein Feld `bodyFormat` (`markdown` | `document`),
   alte Zeilen und alte Events gelten als `markdown` und rendern unverändert. Der
   Edit-Screen zeigt den Document-Editor; eine Markdown-Seite wird beim Öffnen nach HTML
   konvertiert, Speichern schreibt `document`. Der Server rendert `document` über den
   vorhandenen Sanitizer aus template-resolver (`sanitizeDocumentHtml`). Was der Sanitizer
   nicht ausdrücken kann, wird als Feldfehler gemeldet und nie still verworfen. Keine
   Massen-Umschreibung, keine direkten Writes auf Entity- oder Event-Tabellen.
3. **FormScreenLayout.** FW-Formular-Masken mit eigener Karte (`<Form title subtitle actions>`)
   wechseln auf `FormScreenLayout`: Text-Block- und Collection-Editor
   (template-resolver), Secrets-Edit, Löschantrag (user-data-rights), Profil
   (user-profile). Auth- und MFA-Screens bleiben Karte. Collections bekommen ein Formular
   zum Anlegen neuer Einträge („+“ an der Collection im Nav, Titel „New …“).
4. **marketing-demo.** Die Screenshot-Spec läuft wie die anderen Samples über `runMatrix`.
   Das Dark-Theme (dunkle Sidebar auf cremefarbenem Inhalt) wird an der Ursache in Theme
   oder Renderer repariert, nicht in der Spec.

## Schnitt

Ein PR in kumiko-framework, Commits in dieser Reihenfolge:

1. Screenshot-Szenarien für die betroffenen Masken, marketing-demo auf `runMatrix`.
2. Editor-Formate, Codemod, Speicherformat-Default, `{{name}}`-Überführung, Entfernen des
   alten Editors.
3. Collection-Anlegen und FormScreenLayout-Umstellung.
4. managed-pages `bodyFormat`, Document-Editor im Edit-Screen, sicherer Server-Render.
5. marketing-demo Dark-Theme.
6. Changeset mit Breaking-Hinweis, Codemod-Verweis, `changes.json`, generierte Docs.

## Consumer

In dieser Runde nicht angefasst, nur im Changeset beschrieben:

| Repo | Betroffen | Zu tun beim Bump |
| --- | --- | --- |
| solon | `ai-orchestration/web/reply-composer.tsx` importiert `RichContentEditor` | auf `DocumentContentEditor` aus `template-resolver/web` umstellen, `plain-text-draft.ts` prüfen |
| publicstatus | managed-pages gemountet | Migration für `bodyFormat` erzeugen, Seiten im Document-Editor abnehmen |
| money-horse | managed-pages gemountet | wie publicstatus |
| show-pony | managed-pages gemountet | wie publicstatus |
| alle | Collections mit `contentFormat: "rich"`/`"markdown"` | `bun kumiko-upgrade --apply` (Codemod) |
