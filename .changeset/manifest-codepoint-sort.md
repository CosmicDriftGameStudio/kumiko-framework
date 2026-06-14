---
"@cosmicdrift/kumiko-framework": patch
---

feature-manifest: sort by codepoint instead of `localeCompare` (#330)

`buildManifestFromRegistry` sorted features, config keys and secrets with
`String.localeCompare`, whose ordering depends on the running machine's ICU
locale. Since the manifest is serialized to byte-exact JSON (the
`use-all-bundled` and enterprise generators commit it, and docs CI byte-compares
it), the bytes could drift between a macOS dev box and Linux CI. The three sorts
now use a locale-independent codepoint comparator.

Byte-identical for all current manifests — every feature name and qualified
name is lowercase-kebab, for which codepoint and locale order agree. This closes
the latent cross-locale drift before a mixed-case or non-ASCII name ever
introduces it.
