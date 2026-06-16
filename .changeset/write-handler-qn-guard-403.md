---
"@cosmicdrift/kumiko-framework": minor
---

Validate Custom-Screen `dispatcher.write` QNs at compile/boot/CI (#403) and
harden config system-scope writes (#405).

**#403 — Write-handler QN safety**

- Codegen exports `WriteHandlerQn`, `TypedDispatcher`, and
  `createTypedDispatcher()` from `@app/define` when handler QNs are known.
- Boot scans app `src/**` for string-literal `dispatcher.write(...)` calls and
  fails fast against the live registry (`validateAppCustomScreenWriteQns`).
- Shared extractor in `write-handler-qn-extract.ts` for boot validation.

**#405 — Config scope write gate**

- `checkScopeWriteAccess`: writing at `scope: "system"` requires `SystemAdmin`
  (or `SYSTEM_ROLE`), not merely `TenantAdmin` membership in `access.write`.
  Blocks raw-dispatch elevation to the platform-default row on tenant-scoped keys.
