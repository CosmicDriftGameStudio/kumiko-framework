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

`by-tenant`, `by-slug` und `set` im template-resolver nehmen dafür ein
optionales `kind`. Beide Queries sind anonym erreichbar (öffentliche
Legal-Seiten brauchen das), deshalb bleibt der Default `text-block` und jeder
andere kind verlangt TenantAdmin oder SystemAdmin.

Bestehende Apps ändern nichts: `textBlocksClient({ navId })` verhält sich
unverändert, und ohne deklarierte Collections bleibt der abgeleitete Pfad leer.
