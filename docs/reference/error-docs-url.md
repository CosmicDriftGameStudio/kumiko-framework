---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3541; errors/docs-url.ts, errors/serialize.ts"
---

# Error-`docsUrl` und `errorDocs`

Fehlerantworten tragen optional `error.docsUrl`, einen Link auf eine Doku-Seite zum Fehler.
Aufgelöst wird er beim Serialisieren durch `resolveErrorDocsUrl(err, errorDocs?)`.

| Fall | `docsUrl` |
| --- | --- |
| Kein `details.reason`, Reason == Code oder Framework-Reason (`FrameworkReasons`, `AgentReasons`) | `<KUMIKO_DOCS_URL>/errors/<reason oder code>` |
| App-eigener Reason, von `errorDocs` abgedeckt | `<errorDocs.baseUrl>/errors/<reason>` |
| App-eigener Reason, nicht abgedeckt | fehlt |

`KUMIKO_DOCS_URL` (Default `https://docs.kumiko.rocks`) überschreibt nur die Basis für
Framework-Reasons, z. B. für Self-Hosting.

## `errorDocs`

```ts
runProdApp({
  // ...
  errorDocs: { baseUrl: "https://docs.myapp.example", reasons: ["order_locked"] },
});
```

- `baseUrl`: Basis der App-Doku; die Seite liegt unter `<baseUrl>/errors/<reason>`.
- `reasons`: Liste der Reasons mit Doku-Seite, oder `"all"`. Ohne Angabe ist kein App-Reason abgedeckt.

Die Option gibt es auch bei `runDevApp`, `createKumikoServer`, `buildServer` und `setupTestStack`.
Clients behandeln `docsUrl` als optional (`ErrorResponseBody.docsUrl?`).
