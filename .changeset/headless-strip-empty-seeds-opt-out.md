---
"@cosmicdrift/kumiko-headless": minor
---

`SubmitConfig` gained an optional `stripEmptySeeds?: boolean` field. With `payloadMode: "values"`, the form controller strips untouched fields that are still `""` (the seed `buildInitialValues` gives controlled optional inputs) before dispatch, because `.optional()` server schemas accept `undefined` but not `""`. Some handlers legitimately expect `""` unchanged; set `stripEmptySeeds: false` on `SubmitConfig` to opt out of the stripping and send those fields as-is. Default is `true`, matching prior behavior.
