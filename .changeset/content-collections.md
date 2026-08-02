---
"@cosmicdrift/kumiko-framework": minor
---

Content-Foundation Phase 2: Content-Collections mit eigenen Rollen pro Sammlung

Bisher gab es genau einen Content-Tree pro App, hart auf `kind = "text-block"`.
Apps deklarieren ihre Sammlungen jetzt beim Mounten, jede mit eigener
Zugriffsregel und eigener Stelle in der Navigation:

```ts
createTemplateResolverFeature({
  collections: [
    { id: "reply-snippets", kind: "mail-html",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.snippets", parent: "mail:nav:root" } },
    { id: "ai-prompts", kind: "ai-prompt",
      access: { roles: ["PromptEngineer"] },
      nav: { label: "mail:nav.prompts", parent: "mail:nav:root" } },
  ],
});
```

`access` gehört an den Mount, weil ein bundled-feature das Rollenvokabular der
App nicht kennt — dasselbe Muster wie bei `tags`, `folders` und `ledger`.

Jede Collection bekommt eigene Handler (`<id>-list`, `<id>-item`, `<id>-set`)
mit der Access-Regel ihrer Collection, sodass der Dispatcher die Trennung
durchsetzt: wer Antwort-Bausteine pflegen darf, kommt an den AI-Prompts nicht
vorbei. Der Payload trägt keinen `kind`; zwei Collections dürfen denselben
`kind` mit unterschiedlichen Regeln führen.

Neu im Registrar: `r.contentCollection()` legt den Nav-Knoten mit
`provider: true` an und hinterlegt die Collection im Schema. Neu im
Client-Vertrag: `navProvidersFromCollections`, damit ein Feature pro Sammlung
einen Tree-Provider bauen kann, ohne dass der Renderer bundled-features kennt.

`by-slug` und `by-tenant` bleiben unverändert öffentlich und fest auf
`text-block` — der anonyme Pfad für Legal- und Landing-Pages. `textBlocksClient
({ navId })` verhält sich wie bisher; Apps ohne deklarierte Collections ändern
nichts.

`ownership: "user"` ist im Typ vorhanden, aber noch nicht implementiert
(braucht `ownerId`, partiellen Unique-Index und PII-Annotation) — der Mount
wirft mit Verweis auf das Folge-Issue, statt allen Usern still denselben
tenant-weiten Satz zu zeigen.
