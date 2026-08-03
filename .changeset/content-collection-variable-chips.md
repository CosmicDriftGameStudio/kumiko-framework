---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`ContentCollectionDefinition` accepts a new `variableSchema` field — fixed variable names the app declares for a collection (e.g. an `ai-prompt` collection's `{customerName}`, `{orderId}`). The renderer gets `VariableChips`, an editor-agnostic chip bar that inserts `{{name}}` at the caret on click, and `renderer-web` gets `PlainContentEditor`, which pairs it with the existing textarea fallback. `template-resolver`'s client now registers `PlainContentEditor` under `contentEditors.plain` and passes the collection's variable names through, so AI-prompt and mail-html collections with `contentFormat: "plain"` get the chip bar without any app-side wiring.
