---
"@cosmicdrift/kumiko-framework": patch
---

The generated config settings-workspace switcher gate computed its access union
from the raw masked-key list, which includes machine-only keys (write `["system"]`).
That leaked the `"system"` role into the workspace `access` (e.g. `["system",
"SystemAdmin"]` instead of `["SystemAdmin"]`) whenever a machine-only key sat in the
hub next to a human-writable one. No human carries `"system"`, so there was no access
effect, but it contradicted the build-time exclusion the rest of the schema applies.
The workspace access is now the union of the already machine-filtered hub navs, so
`"system"` can no longer appear.
