---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

entityEdit and actionForm screens accept `slots.titleAction`: an extension component rendered on the right of the form title, in the same row — for status chips or allowance badges that belong to the screen. `FormProps.titleAction` carries it to the primitives; the web form renders it in `<testId>-title-action`.
