---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
"@cosmicdrift/kumiko-locale-de": minor
---

Form gaps for settings screens:

- A `writeForm` section that fills a whole tab puts its submit button into the pinned form footer.
- `optionsQuery` rows may carry `description` (muted second line) and `group` (heading). The combobox and the radio list show both. Options with either one never render as segments.
- `optionsQueryPayload` values may be `{ field: "<sibling>" }`. The select reloads when that field changes and clears a value the new rows no longer contain. On config keys, `field` names another key of the same feature on the same settings mask. The boot validator checks the names, and `writeForm` fieldDefs now go through the select checks too.
- The source badge on `configEdit` fields shows the option label instead of the raw value or id.
- New `writeOnly: true` on entity text fields with `find: "secret"`. Reads return `true` (set) or `null` and never the value. On write, `""` keeps the stored value and `null` clears it. The edit form shows a masked input with a "set" placeholder and a remove action.
