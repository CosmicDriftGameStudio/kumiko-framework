---
"@cosmicdrift/kumiko-bundled-features": patch
---

Clarify why `MfaEnableScreen` imports `qrcode/lib/browser` (Metro doesn't
honor `qrcode`'s package.json#browser remap) and that consuming apps need
their own local ambient `.d.ts` shim for the subpath — TypeScript can't
auto-discover an ambient declaration sibling from inside a node_modules
package when apps typecheck this raw `.tsx` source directly. No runtime
change; the previous comment incorrectly suggested a triple-slash
reference would work across package boundaries — it doesn't.
