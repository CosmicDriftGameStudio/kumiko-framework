---
"@cosmicdrift/kumiko-framework": patch
---

fw#2218: the generated Settings-Hub `configEdit` screen rendered narrow and centered, and had no room for a section description. `buildConfigFeatureSchema` now sets `layout.width: "full"` on every generated screen, and adds a section `description` (`<feature>.settings.description`) whenever the feature actually declares that translation key — features that don't declare it keep the section without a `description` prop, so `translate()` never leaks a raw undeclared key onto the screen.
