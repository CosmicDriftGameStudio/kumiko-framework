---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

entityEdit/wizard screens mount `slots.footer` (resolved via `extensionSectionComponents`, like the list `slots.header`) in the form footer next to the submit action; the component receives `entityName`, `entityId`, `values`, `hasUnsavedChanges`, `wizardStep` ({index,isLast}, wizard only). Screens without the slot are unchanged; footer action row now wraps on narrow viewports.
