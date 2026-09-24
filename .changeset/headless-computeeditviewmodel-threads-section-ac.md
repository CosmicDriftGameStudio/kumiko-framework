---
"@cosmicdrift/kumiko-headless": minor
---

computeEditViewModel threads section.actions and EditRelatedListSection.emptyState into the view model (fw#3234)

EditFieldsSectionViewModel, EditExtensionSectionViewModel, EditRelatedListSectionViewModel and EditWriteFormSectionViewModel all carry the spec's optional `actions` unchanged; EditRelatedListSectionViewModel's `emptyState.title`/`description` are translated the same way section.title already is.

<!-- kumiko-changes
feature: headless
type: improvement
title: computeEditViewModel threads section.actions and EditRelatedListSection.emptyState into the view model (fw#3234)
migration: |
  Additive — a view model without actions/emptyState in its spec is unaffected.
-->
