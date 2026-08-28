---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-renderer": minor
"@cosmicdrift/kumiko-renderer-web": minor
---

`projectionDetail` screens can now declare an optional record header (`header: { title, subtitle?, status? }`), a metrics band (`metrics: string[]`, labeled via `fieldLabels`), and a tabbed layout (`layout.mode: "tabs"`) alongside the existing single-section layout. All three are additive — a screen that doesn't set them renders unchanged. Tabs are read via a new `Tabs` Core-Primitive (wired to a vendored shadcn/Radix implementation in `kumiko-renderer-web`) and driven by the `?tab=` search param; only the active tab's section mounts, so its query fires on selection instead of upfront.
