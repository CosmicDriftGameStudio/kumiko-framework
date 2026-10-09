---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

Section actions render in the title row instead of a footer; WriteFormSection submit moves below its fields

<!-- kumiko-changes
feature: renderer
type: breaking
title: Section actions render in the title row instead of a footer; WriteFormSection submit moves below its fields
migration: |
  Section.actions (renderer-web DefaultSection) render top right in the title row since #3241, no longer as a footer. A button that depends on content below it (a confirmation checkbox, a list it acts on) belongs in the section's children instead of actions. WriteFormSection's own submit button now sits below its fields; caller actions stay in the title row.
-->
