---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

A `longText` form field takes `editor: "document"` and then uses the rich-text editor registered for "document" (value: HTML string), falling back to the textarea without one. An actionForm `preview` takes `section: "<section-id>"` to render at the end of that layout section instead of below the form. A form field with `editor: "document"` shows text formatting only (new `ContentEditorProps.formatting: "text"`), and the document editor hides the placeholder button when it has no variables. `aiAssist.autoRun: false` stops the query from re-running on every `contextFields` change; chips and the instruction field still run it with the context values. A URL or handoff prefill of a multi-reference field now accepts a single id, a comma list or a JSON array (a single id used to give an empty selection).

<!-- kumiko-changes
feature: renderer
type: improvement
title: Document editor for longText fields, preview inside a section
detail: Field option `editor: "document"` (longText only; works with `aiAssist`: the text is inserted as paragraphs) renders the registered document editor instead of a textarea; boot rule `form/editor-field-type`. New fields-section option `flow: false` gives a screen form or drawer section a grid of `columns` equal cells; without it the flow layout (field width by type) stays as before. `ActionFormPreview.section` places the preview panel at the end of a fields section with that id (boot rule `action-form-preview/section-unknown`); without it the panel stays below the form, and without `title` it has no title row.
-->
