---
"@cosmicdrift/kumiko-guards": minor
---

New Raw section.fields Guard

The boot-validator enforces `fields` XOR `groups` on edit sections, so a section carrying `groups` has `fields: []` — every reader that iterates `section.fields` walks an empty list there and silently sees no field at all. That same cause produced three independent regressions (kumiko-framework#2986, then the boot-guard and the E2E generator in #3042). The new guard flags for-of, spread and array reads over a section's `fields` in the layer where a section is a spec (framework engine/i18n/testing, headless, renderer app shims) and points at `sectionFieldSpecs(section)`, the one reader that unions both sources. A deliberate raw reader declares itself with `// kumiko-lint-ignore section-fields-raw <reason>` on the line or the line above — a bare tag without a reason stays a finding, so there is no silent exception list. `section.fields.length` is a known gap: the fields-XOR-groups validator itself needs it and an emptiness check is not the silent-iteration bug. Ratcheted against `.kumiko-section-fields-raw-baseline.json`, warning-only in a repo that has not frozen one yet.

<!-- kumiko-changes
feature: guards
type: improvement
title: New Raw section.fields Guard
-->
