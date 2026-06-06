---
"@cosmicdrift/kumiko-bundled-features": patch
---

fix(foundation-shared): trim whitespace in `requireNonEmpty` — whitespace-only config values are now rejected and surrounding whitespace is stripped, so a stray `" host "` no longer reaches the provider SDK as-is
