---
"@cosmicdrift/kumiko-framework": minor
---

Content-Foundation Phase 2: `r.contentCollection()` mountet Template-Sammlungen fachlich

Ein Feature registriert seine Content-Sammlung jetzt dort, wo sie hingehört —
Mail-Vorlagen unter Mail statt in einem zentralen "Content"-Bereich:

```ts
r.contentCollection({
  id: "templates",
  kind: "mail-html",
  nav: { label: "mail:nav.templates", parent: "mail:nav:root" },
});
```

Das legt den Nav-Knoten an (immer `provider: true`) und gibt seine QN zurück.
Der Client baut pro Collection einen eigenen Folder-Tree, gefiltert auf ihren
`kind` — `navId` und `kind` können nicht mehr auseinanderlaufen, weil beides
aus dem Schema kommt.

Dafür gibt es zwei neue Queries, `collection-list` und `collection-item`:
beliebiger `kind`, per `access` auf TenantAdmin/SystemAdmin beschränkt.
`by-slug` und `by-tenant` bleiben unverändert öffentlich und fest auf
`text-block` — sie nehmen bewusst keinen kind-Parameter, sonst wären
Mail-Vorlagen und AI-Prompts ein Payload-Feld vom anonymen Pfad entfernt.
`set` nimmt ein optionales `kind` und braucht keinen Split, weil er ohnehin
admin-only ist.

Bestehende Apps ändern nichts: `textBlocksClient({ navId })` verhält sich
unverändert, und ohne deklarierte Collections bleibt der abgeleitete Pfad leer.
