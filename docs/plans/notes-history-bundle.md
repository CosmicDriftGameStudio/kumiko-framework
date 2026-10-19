---
status: in-progress
verified: 2026-08-01
issue: solon#13
next: "solon-Umstieg (Contact-Feld ersetzen) als eigenes S/M-Issue in solon"
---

# Notizverlauf — append-only Notizen an beliebigem Entity

Ausgangsproblem (solon#13): `notes` ist heute ein einzelnes `createLongTextField`
am Contact (`solon/src/features/contact/entity.ts:151`). Wer etwas ergänzt oder
überschreibt — Autor, Zeitpunkt, vorheriger Stand — ist nicht rekonstruierbar.
Gewünscht: mehrere Einträge, je mit Autor + Zeitstempel, chronologisch, wie im
CRM-Muster.

Owner-Entscheidung (2026-08-01): als **eigenes Kumiko-Bundle** bauen, nicht als
solon-Feature — universelles Pattern, gehört ins Framework (`kumiko-bundled-features`
Reuse-Regel).

## Vorbild-Pattern (Recherche im framework-Repo)

Zwei bestehende Bundles zusammen ergeben das Grundgerüst:

- **`tags`** (`kumiko-framework/packages/bundled-features/src/tags/`) zeigt das
  generische "Entity X ↔ Sub-Feature Y"-Pattern: eine Zuordnungs-Entity
  (`tag-assignment`) mit `entityType`/`entityId`-Feldern, Read-Layer filtert rein
  über diese Felder, keine JOINs, kein Host-Column-Zugriff auf fremde Entities.
  Für Notizen ist **keine** deterministische Aggregate-ID nötig (anders als bei
  tags), da beliebig viele Einträge pro Entity erlaubt sind — normale
  event-sourced create-only Writes reichen, kein Update/Delete.
- **`audit`** (`.../src/audit/`) zeigt das append-only-Query-Pattern (Liste +
  Detail, `access: { roles: access.admin }`), auch wenn audit selbst ohne eigene
  Tabelle direkt den Event-Store liest — für Notizen brauchen wir dagegen eine
  eigene Tabelle, da Notizen kein System-Audit-Log sind, sondern Nutzerinhalt.

## Gebautes Bundle: `notes-history` (Status: umgesetzt)

Pfad: `kumiko-framework/packages/bundled-features/src/notes-history/`

```
constants.ts       Feature-Name, Handler/Query-QNs, Extension-Namen
entity.ts           note-entry: entityType, entityId, authorId (subjectRef),
                     body (createLongTextField, userOwned) — insertedAt/
                     insertedById kommen als Base-Columns automatisch, kein
                     eigenes createdAt-Feld nötig
executor.ts          createEntityExecutor-Instanz + exportierte Tabelle
schemas.ts            addNotePayloadSchema (entityType, entityId, body)
handlers/
  add-note.write.ts   custom Write-Handler — authorId wird IMMER server-
                       seitig aus event.user.id gestempelt, nie aus dem Payload
feature.ts            defineFeature("notes-history", …), r.entity,
                       r.writeHandler(add-note), r.queryHandler(list),
                       r.translations — kein r.screen (kein Standalone-Screen)
i18n.ts / index.ts
web/
  notes-section.tsx    <NotesSection entityName entityId /> — Liste + Textarea,
                        limit:200 (ponytail-markiert, Upgrade-Pfad: Cursor)
  client-plugin.tsx / i18n.ts / index.ts
```

Registrierung über Subpath-Exports in `packages/bundled-features/package.json`
(kein zentrales Registry-File):
```
"./notes-history": "./src/notes-history/index.ts",
"./notes-history/web": "./src/notes-history/web/index.ts",
```

**Bewusst strikt append-only**: nur `add-note` (create) und die Liste sind
registriert — kein Update, kein Delete. Eine Korrektur ist ein neuer Eintrag,
sonst verliert das Feature seinen Zweck (Nachvollziehbarkeit).

### GDPR-Companion: `notes-history-user-data`

Wie bei `folders-user-data` getrennt gehalten, damit `notes-history` ohne die
`user-data-rights`-Pipeline nutzbar bleibt (harte Requires nur im Companion):
Export-Hook liest `note-entry` gefiltert nach `authorId`; Delete-Hook ist ein
bewusster No-op (Erasure über Crypto-Shredding des Autor-Subject-Keys, siehe
`hooks.ts`-Kommentar zum KMS-Vorbehalt — ohne gemountetes KMS bleibt `body`
framework-weit Klartext, das ist eine Eigenschaft des Crypto-Shredding-Designs,
nicht bundle-spezifisch).

### Sample + Tests

- `samples/recipes/notes-history-basic/` — Recipe nach `tags-basic`-Vorbild
  (plain `task`-Entity, `notesFlow` in `usage.ts`, README mit `file=`-Embed,
  Integrationstest).
- `packages/bundled-features/src/notes-history/__tests__/` — 6 Integrationstests
  (Autor-Stamping, Payload-Override wird ignoriert, Mehrfach-Notizen, Read-Layer-
  Filter, Multi-Tenant-Isolation, leerer Body wird abgelehnt).
- `packages/bundled-features/src/notes-history-user-data/__tests__/` — 3 Tests
  (Export nur eigene Notizen, leer bei 0 Notizen, Delete-Hook ist No-op).
- `samples/apps/use-all-bundled` mountet beide Features (`run-config.ts`,
  `schema/generate.ts`, `gen:manifest`), Worktree-Check (`tsc` + `biome` +
  alle Unit-/Integrationstests) lief grün, relevante Guards
  (`guard-feature-integration-tests`, `guard-feature-changelog`,
  `guard-i18n-keys`, `guard-primitives-discipline`, `guard-cross-feature-imports`)
  einzeln lokal geprüft.

## solon-Umstieg (Folge-Schritt, eigenes Issue nach diesem PR-Merge)

- `notes`-Feld aus `solon/src/features/contact/entity.ts:151` entfernen —
  Datenübernahme der bestehenden Freitexte in `note-entry` (einmalige Migration,
  ein Eintrag pro Contact mit `authorId: system`).
  - **Keine Opt-in-Migration** — bestehende Notizen müssen automatisch landen,
    nicht nur für neue Contacts gelten (`feedback_no_opt_in_migration`).
- Formular-Section `fields: ["notes"]` in `solon/src/features/contact/feature.ts:164`
  durch `<NotesSection>` ersetzen.
- i18n-Keys `contact.section.notes` / `contact:entity:contact:field:notes`
  (`solon/src/features/contact/i18n.ts:17,64`) entfernen, Bundle bringt eigene.
- PII-Kommentar in `solon/src/features/gdpr-hooks/feature.ts:25` anpassen — PII
  wandert vom Contact-Feld ins neue Bundle, GDPR-Hook muss `note-entry` statt
  `contact.notes` erfassen (bzw. `notes-history-user-data` mounten).
- Analoges `notes`-Feld in `solon/src/features/protocol/entity.ts:92` ist NICHT
  Teil dieses Issues (separater Consumer, eigene Entscheidung ob/wann Umstieg).

## Entschiedene Fragen

1. Edit/Delete für eigene Notizen? → **Nein, strikt append-only** wie audit.
   Korrektur = neuer Eintrag.
2. Rich-Text oder Plaintext? → **Plaintext** (`createLongTextField`, wie das
   ersetzte Feld), kein Formatierungsbedarf im Issue erkennbar.

## Nächste Schritte

1. Framework-PR (`kumiko-framework` feat/notes-history-bundle) reviewen + mergen.
2. `docs/feature-reference/notes-history.mdx` + `docs/samples/recipes-notes-history-basic.md`
   werden nach dem Merge automatisch via `kumiko docgen` generiert (aus dem
   README + `r.describe`) — kein manueller Schritt.
3. Danach solon-Umstieg (Abschnitt oben) als eigenes S/M-Issue in solon, dann
   `/issue-ship`-geeignet.
4. Issue solon#13 bleibt offen, referenziert dieses Doc, wird erst nach Schritt 3
   geschlossen (`status: shipped` + Verschieben nach `docs/archive/plans/`).
