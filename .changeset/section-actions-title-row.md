---
"@cosmicdrift/kumiko-renderer-web": patch
"@cosmicdrift/kumiko-renderer": patch
---

`Section.actions` render in the title row (top right) since #3241 instead of as a footer. Buttons that depend on content below them (a confirmation checkbox, for example) belong in the section's children. The `WriteFormSection` submit button now sits below its fields instead of in the title row

<!-- kumiko-changes
feature: renderer
type: improvement
title: Section actions render in the title row, WriteFormSection submit moves below the fields
-->
