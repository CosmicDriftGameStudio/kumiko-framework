---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

feat(screen-types): FieldFormatRegistry + FormatSpec ersetzen function-Renderer

`FieldRenderer` akzeptiert keine Inline-Funktionen mehr — sie wurden von
`JSON.stringify` in der `buildAppSchema → window.__KUMIKO_SCHEMA__`-Pipeline
still gedroppt, was zu unsichtbaren Render-Fehlern führte.

Neu: `FormatSpec` — deklarativer, JSON-sicherer Formatter-Typ:
  `{ format: "timestamp" }` | `{ format: "currency", symbol: "€" }` |
  `{ format: "boolean", trueLabel: "Ja", falseLabel: "Nein" }` |
  `{ format: "priority", prefix: "P" }` | `{ format: "date" }`

Apps erweitern das Built-in-Set per module augmentation:
  ```ts
  declare module "@cosmicdrift/kumiko-framework" {
    interface FieldFormatRegistry { myFormat: { myOption?: string } }
  }
  ```

`renderer-web` kennt alle Built-in-Keys; unbekannte App-spezifische Keys
fallen auf `String(value)` zurück.

Migration: Inline-Funktionen durch das passende `{ format: "..." }` ersetzen.
