---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-document-designer": patch
---

Designer shows placeholder labels instead of raw names

<!-- kumiko-changes
feature: document-designer
type: fix
title: The designer names placeholders by their label everywhere
detail: Placeholder chips in the mail subject, the header label, the footer note and the paper editor now show only the variable's label; the raw name stays available as a tooltip. The tone select reads "From placeholder: <label>" instead of "{{tone}}", and the validation notes in the preview list labels instead of names. The file-name hint in the settings is translated (de, en, es). Unknown placeholders and variables without a label still show their name.
-->
