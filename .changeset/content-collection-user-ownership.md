---
"@cosmicdrift/kumiko-framework": minor
---

Content-Collections: `ownership: "user"` implementiert

Eine Collection kann jetzt `ownership: "user"` tragen — jeder Enduser pflegt
seine eigenen Einträge (Mail-Signaturen, persönliche Antwort-Bausteine), statt
einen tenant-weiten Satz zu teilen. Bisher warf der Mount an dieser Stelle.

```ts
createTemplateResolverFeature({
  collections: [
    {
      id: "signatures",
      kind: "mail-html",
      ownership: "user",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.signatures" },
    },
  ],
});
```

User-owned Einträge liegen in einer eigenen Entity (`user-content-entry`,
Tabelle `read_user_content_entries`) mit `ownerId NOT NULL` und Unique-Index
`(tenantId, ownerId, slug, kind, locale)` — zwei Agents können damit beide eine
Signatur `standard` haben.

Nicht in derselben Tabelle mit nullbarer `ownerId`, weil `content` dort
`userOwned` trägt (Name, Telefon, Anschrift → crypto-shredding). Diese
Annotation wird pro Entity aufgelöst, nicht pro Zeile, und
`resolveSubjectForField` wirft bei leerer Owner-Spalte: jede tenant-weite
Mail-Template-Zeile würde beim Schreiben scheitern.

**Zwei Pflichtschritte beim Mounten einer user-owned Collection:**

1. Migration erzeugen (`bunx kumiko-schema generate <name>` + `apply`) — die
   Entity kommt erst in den Schema-Diff, wenn eine solche Collection deklariert
   ist. Ohne die Tabelle antwortet der Handler in Prod mit 500.
2. Das neue Feature `template-resolver-user-data` mitmounten. Die Entity trägt
   Subject-Daten; ohne EXT_USER_DATA-Hook verweigert der Boot-Guard den Start.
   Es liefert den Art.-20-Export; Art. 17 läuft über crypto-shredding statt
   über einen physischen DELETE, der bei einer event-sourced Entity nicht
   replay-fest wäre.

Unter `tenantIdOverride` schreibt ein SystemAdmin auch im fremden Tenant seinen
**eigenen** Eintrag — nie die Signatur eines anderen.
