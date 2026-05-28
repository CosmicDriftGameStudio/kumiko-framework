---
"@cosmicdrift/kumiko-bundled-features": patch
---

custom-fields: tighten set-custom-field value-validation to pure type-only.

`buildCustomFieldValueSchema` now strips `required`, `maxLength`, `format`, and
`default` from the rehydrated `serializedField` before handing it to
`fieldToZod`, so the runtime schema validates the TYPE-shape only — matching
the handler's documented scope ("NUR Type-Validation"). Pre-fix `fieldToZod`
folded these keys into Zod refinements asymmetrically: `text` with
`required:true` rejected empty strings while `number` constraints in
`serializedField` were silently ignored.

The supported-types pre-check (with explicit known sub-types for `embedded`)
also replaces the catch-all try/catch — unexpected throws from `fieldToZod`
now propagate as real bugs instead of silently disabling validation.

Behavior change: empty strings, over-`maxLength` text, and non-email/url
strings on `text` fields with constraint keys in `serializedField` now pass
set-custom-field. Use a separate validation layer if you need them rejected
on set; required-on-set + length/format enforcement remain explicit
non-goals of the handler (Plan-Doc "Stammfeld-Identität").
