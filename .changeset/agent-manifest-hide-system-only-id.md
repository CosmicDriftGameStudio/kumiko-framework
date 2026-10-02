---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Agent tool manifests no longer offer the caller-chosen `id` on create tools, since agent dispatch never runs as a system identity and the value was silently dropped. Combobox options now carry a value-based `data-testid`.
