---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

`useNavigateWithInitialValues` takes `{ submitThrough: { handler, wrap, valuesKey } }` so an app can open a prefilled actionForm whose submit goes through another write handler (`{ ...wrap, [valuesKey]: values }`) while server field errors still land on the form's fields. An actionForm preview list column may have `type: "file"` and then shows the file behind a FileRef id with name and download link.

<!-- kumiko-changes
feature: renderer
type: feature
title: Submit an actionForm through another write handler
detail: `useNavigateWithInitialValues(target, values, { submitThrough: { handler, wrap, valuesKey } })` opens the prefilled actionForm as usual but submits `{ ...wrap, [valuesKey]: values }` to `handler`. Server field errors under `<valuesKey>.<field>` appear at the field. entityEdit and secretMint ignore the option. A preview list column may have `type: "file"` (FileRef id shown with name and download link).
-->
