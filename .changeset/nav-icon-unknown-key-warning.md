---
"@cosmicdrift/kumiko-renderer-web": patch
---

A nav entry's `icon` key that isn't registered in `NAV_ICONS` (typo, or a dynamically/provider-resolved key the type system can't check) used to fall back to the dot indicator with no diagnostic at all — indistinguishable from an entry that never set an icon. `NavLeadingIcon` now emits a `console.warn` naming the nav entry's qualified name and the unknown key when this happens, while the dot fallback itself is unchanged.
