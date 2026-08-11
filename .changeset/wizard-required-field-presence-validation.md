---
"@cosmicdrift/kumiko-framework": patch
---

The auto-wired `entityEdit` path now passes `RenderEdit` a presence schema that checks every rendered required field has a value. Wizard step navigation blocks on empty required fields instead of silently advancing. Format, range, and type validation stay server-side, since the client form state and the server payload shape differ per field type.
