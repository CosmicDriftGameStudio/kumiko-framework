---
"@cosmicdrift/kumiko-dev-server": patch
---

dev-server: `define.ts`-Codegen für `TypedDispatcher`/`WriteHandlerQn` reexportierte den Typ nur (`export type { X } from "..."`), ohne ihn lokal zu binden — mit `verbatimModuleSyntax: true` (Standard-tsconfig aller Apps) brach das den eigenen `TypedDispatcher`-Typ mit "Cannot find name 'WriteHandlerQn'". Jetzt `import type` + separater `export type`-Reexport.
