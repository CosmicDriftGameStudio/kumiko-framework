---
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

`renderer-web` gets `RichContentEditor`, the `contentFormat: "rich"` WYSIWYG editor (bold, italic, headings, lists, autolinking) — built on tiptap, dynamic-imported so an app that never mounts a "rich" collection never pays for it, and falling back to the plain textarea while the chunk loads. tiptap is a `dependencies` entry on `renderer-web` only, same as radix/cmdk/lucide — no tiptap type crosses the editor's public `{ value, onChange, variables, readOnly }` contract. `template-resolver`'s client now registers `RichContentEditor` under `contentEditors.rich`, so `rich` collections (e.g. mail-html templates) get the WYSIWYG without any app-side wiring.
