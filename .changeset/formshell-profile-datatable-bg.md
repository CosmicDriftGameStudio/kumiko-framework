---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer-web": patch
---

Consistency: user-profile's ProfileScreen adopts the shared `FormScreenShell` (centered `max-w-3xl` like all other settings screens, was left-aligned `max-w-5xl`). DataTable now sits on `bg-card` instead of a transparent surface — on themes with a colored page background (e.g. cream) lists previously didn't match the white cards; now they do.
