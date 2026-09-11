---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

fw#2752: `style: "danger"` is now allowed on the `navigate` and `drawer` variants of `RowAction` and `ToolbarAction` — there it only renders the action red, the forced confirm dialog stays bound to the `writeHandler` variants. `ActionFormScreenDefinition.submitStyle: "danger"` marks the form's submit button as destructive.
