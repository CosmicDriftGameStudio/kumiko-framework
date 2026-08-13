---
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-dev-server": patch
---

`runDevApp` checked for a mounted sessions provider with a raw pre-registry scan (`features.some(f => f.extensionUsages...)`) instead of `registry.getExtensionUsages(EXT_SESSION_STORE)` like `runProdApp` — two different ways of asking the same question. Unified onto the registry-based check, and gave dev the same boot gate prod already had (`assertSessionBootInvariants`, now `mode: "prod" | "dev"`): prod still aborts boot when auth is mounted without a sessionStore provider, dev now warns instead of staying silent. New `@cosmicdrift/kumiko-server-runtime/session-boot-gate` export.

Note: the two extensionUsages predicates read the same underlying array, so this did not reproduce a proven false negative — it removes a divergent mechanism and adds the missing dev-time signal. If a real app's sessions feature is mounted and its session-list is still empty, the new warn will not fire (no sessionStore is "missing" there) and that needs separate investigation.
