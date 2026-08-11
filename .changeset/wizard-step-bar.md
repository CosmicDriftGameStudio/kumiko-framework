---
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

The wizard chrome (`RenderEdit` with `layout.mode: "wizard"`) now renders a step overview above the form instead of just "Step X of Y": numbered chips for every section, the current one highlighted, done ones showing a checkmark. Added the `StepBar` primitive (`CorePrimitives.StepBar`, optional like `Progress`) and its default web implementation (`@cosmicdrift/kumiko-renderer-web`'s `StepBar` widget). On narrow viewports the chip row hides in favor of the previous compact "Step X of Y · &lt;title&gt;" label — both the chrome and the widget stay backward compatible when a custom `PrimitivesRegistry` doesn't supply `StepBar`.
