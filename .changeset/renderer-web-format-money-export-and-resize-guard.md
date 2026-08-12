---
"@cosmicdrift/kumiko-renderer-web": patch
---

- `formatMoney` (currency formatting used internally by `MoneyInput`) is now re-exported from the package barrel, so consumers no longer have to hand-roll their own currency formatter to get correct locale-aware symbol placement and decimals.
- `resizeImageBeforeUpload` now only swaps in the re-encoded image if it's actually smaller than the original — a palette-optimized PNG or an already small in-spec photo could previously come back larger after a full RGBA canvas round-trip (2-5x for PNGs), since the re-encode was always taken regardless of size. EXIF/GPS stripping is now best-effort: an original kept as-is keeps its metadata too.
