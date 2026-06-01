---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Stop swallowing errors at six review-flagged sites (fail-closed / make visible
instead of silently dropping).

- **framework — dispatcher postQuery (single-object result):** a hook that
  returned 0 rows used to fall back to the unhooked original (`rows[0] ?? result`),
  and ≥2 rows silently dropped the extras. A single-object response can only
  carry one row, so this now throws instead of hiding the contract violation.
- **bundled-features — custom-fields write access-gate:** when a field
  definition row exists but its `serialized_field` is corrupt, the per-field
  `fieldAccess.write` check fell open (`{ ok: true }`) and let the write through
  unvalidated. It now fails closed with `field_definition_corrupt` (secure-by-default).
- **bundled-features — compliance-profiles override parser:** a corrupt stored
  override is still ignored, but the warning now preserves the parser's failure
  reason instead of flattening it to a generic message.
- **dev-server — scaffold-deploy:** a malformed `package.json` no longer
  silently skips private-GitHub-package detection; it warns so the
  mis-detection (and a later `yarn install` YN0041) is traceable.
