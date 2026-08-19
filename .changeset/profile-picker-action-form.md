---
"@cosmicdrift/kumiko-framework": patch
---

compliance-profiles: `/profile-picker` is now a declarative `actionForm` screen (select field + extension section for the read-only profile catalog) instead of a 152-line custom TSX screen. Submits to the existing `compliance-profiles:write:set-profile` handler unchanged. Nav entry gained a `shield` icon (fw#2222).
