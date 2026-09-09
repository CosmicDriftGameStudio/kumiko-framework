---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Adds an optional `JsonView` primitive (`@cosmicdrift/kumiko-renderer`'s `CorePrimitives`/`JsonViewProps`) for structured, syntax-highlighted JSON display, with a web implementation (`@cosmicdrift/kumiko-renderer-web`'s `DefaultJsonView`). Fixes `format: "json"` fields (audit `payload`/`metadata`, job `logs`) and the jsonb/embedded/files/images fallback banner rendering as an unreadable single line — HTML collapses the whitespace/newlines `applyFormatSpec("json")` already produces. `JsonView` receives the raw value (not a pre-stringified string) and stringifies + tokenizes itself; also wired into `EditorPanel`'s unresolved-target args display.

Optional (not required) on `CorePrimitives` so existing partial `CorePrimitives` mocks/providers keep compiling; every call site falls back to the prior `<Text>`/`<pre>` behavior when no `JsonView` is registered. Never throws on circular references, `BigInt`, or other non-serializable input.
