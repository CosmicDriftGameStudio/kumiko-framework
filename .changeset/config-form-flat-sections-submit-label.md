---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-headless": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Let the config-generated entity-edit form express the common shadcn form
shapes (title + subtitle, flat single-section layout, domain-specific submit
CTA). Driven by rebuilding real shadcn reference designs purely from the schema
to find what the auto-UI couldn't yet do:

- **Optional section title**: `EditFieldsSection.title` is now optional. A
  title-less section renders just its fields (no `h3`), so a form can be a flat
  "card title + fields directly" layout instead of being forced into a labelled
  sub-section. The whole-form card title/subtitle carries the context.
- **entityEdit submit label**: `EntityEditScreenDefinition.submitLabel` (i18n key
  or raw string) overrides the generic "Save" — e.g. "Save Address", "Create
  item". Wired through `KumikoScreen` (create + update branches) into the
  existing `RenderEdit` `submitLabel` prop.
- **Form subtitle**: `FormProps.subtitle` renders a muted line under the form
  title. `RenderEdit` resolves title + subtitle create/edit-aware via
  `screen:<id>.<create|edit>.title` / `.subtitle` (falling back to
  `screen:<id>.title`/`.subtitle`, then the screen id), so a create screen reads
  "Create item / Add a new item to your catalog" and the edit screen differs.

No breaking changes — existing titled sections and the default save label are
unaffected. A new `styleguide` "Examples" feature rebuilds the shadcn Shipping
Address design from a schema as the first config stress-test.
