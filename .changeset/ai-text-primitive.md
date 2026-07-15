---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

AI-Text primitive: `AiTextField`/`AiTextArea` (renderer-web) — drop-in replacements for `TextField`/`TextareaField` with ghost-text completion (Tab to accept, Esc to discard), and correct/translate/rewrite toolbar actions with a before/after diff preview. Built on `useAiTextAction`/`useCompletion` (renderer) — request/response hooks with debounce, abort, and cap-exceeded/unavailable state. Both degrade gracefully to a plain text field when the server's `ai-text` feature (kumiko-enterprise) isn't mounted — no enterprise import in this public package.
