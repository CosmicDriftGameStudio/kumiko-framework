---
"@cosmicdrift/kumiko-framework": minor
---

`breaking (tests only)`: the four `*ForTests` reset helpers are no longer exported from the `/crypto` and `/db` barrels — they now come from `/testing`, the subpath the rest of the test infrastructure already uses.

```diff
-import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/crypto";
+import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
```

Affected: `resetPiiSubjectKmsForTests`, `resetBlindIndexKeyForTests`, `resetEventPiiCatalogForTests` (were in `/crypto`) and `resetEntityFieldEncryptionCacheForTests` (was in `/db`). The functions themselves did not move — only the export path — so a relative deep-import of the defining module is unaffected.

Why it matters beyond tidiness: `resetPiiSubjectKmsForTests()` clears the injected KMS, after which `encryptForStorage` sees no adapter and writes subject-annotated fields in plaintext, with no error and no log. Reachable from a production barrel, that is one stray import away from silent plaintext PII.
