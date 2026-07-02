---
"@cosmicdrift/kumiko-framework": patch
---

Boot-validator V3: warn when an entity has pii/userOwned-annotated fields but no feature registers an EXT_USER_DATA export/delete hook for it (Art.15/20/17 coverage gap). Runs only when user-data-rights is mounted.
