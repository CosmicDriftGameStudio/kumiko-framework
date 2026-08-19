---
"@cosmicdrift/kumiko-framework": minor
---

`projectionDetail` screens now render read-only fields as plain formatted text instead of disabled Inputs. `RenderField`/`RenderEdit` also consume `EditFieldSpec.renderer` on readOnly fields (FormatSpec or a registered `__component`), matching the existing list-column renderer behavior. New optional `RenderEditProps.valueDisplay`/`RenderFieldProps.valueDisplay` ("form" | "text", default "form" — no change for existing callers) and `ProjectionDetailScreenDefinition.valueDisplay`/`hideActions` let a screen opt out of either the text display or the Cancel action-bar button while keeping `listScreenId` back-navigation (fw#2245).
