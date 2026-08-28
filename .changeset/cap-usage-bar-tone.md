---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-bundled-features": patch
---

Add an optional `tone` to the `Progress` primitive (`default`/`warn`/`danger`, fill color only) and wire `cap-overview`'s usage bar to derive it from the same `computeTone(fraction)` the dashboard cards already use. Previously the bar always rendered the neutral fill regardless of how far over the cap usage was — a tenant at 120% of a limit looked identical to one at 4%.
