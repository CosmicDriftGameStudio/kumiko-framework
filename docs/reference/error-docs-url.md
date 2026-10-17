---
status: reference
verified: 2026-10-04
evidence: "kumiko-framework#3541; errors/docs-url.ts, errors/serialize.ts"
---

# Error `docsUrl` and `errorDocs`

Error responses optionally carry `error.docsUrl`, a link to a documentation page for the error.
It is resolved during serialization by `resolveErrorDocsUrl(err, errorDocs?)`.

| Case | `docsUrl` |
| --- | --- |
| No `details.reason`, reason equals code, or framework reason (`FrameworkReasons`, `AgentReasons`) | `<KUMIKO_DOCS_URL>/errors/<reason or code>` |
| App-specific reason covered by `errorDocs` | `<errorDocs.baseUrl>/errors/<reason>` |
| App-specific reason not covered | `<KUMIKO_DOCS_URL>/errors/<code>` (page of the error code) |

`KUMIKO_DOCS_URL` (default `https://docs.kumiko.rocks`) only overrides the base for
framework reasons, for example for self-hosting.

## `errorDocs`

```ts
runProdApp({
  // ...
  errorDocs: { baseUrl: "https://docs.myapp.example", reasons: ["order_locked"] },
});
```

- `baseUrl`: base of the app docs; the page lives at `<baseUrl>/errors/<reason>`.
- `reasons`: list of reasons that have a docs page, or `"all"`. Without it no app reason is covered.

The option is also available on `runDevApp`, `createKumikoServer`, `buildServer` and `setupTestStack`.
Clients treat `docsUrl` as optional (`ErrorResponseBody.docsUrl?`).
