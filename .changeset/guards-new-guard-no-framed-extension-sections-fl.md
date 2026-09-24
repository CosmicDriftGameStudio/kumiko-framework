---
"@cosmicdrift/kumiko-guards": minor
---

New guard-no-framed-extension-sections flags a registered extension-section component that renders its own Card/SectionCard/CollapsibleSection (fw#3234)

Modeled on guard-no-custom-primitives: scans packages/bundled-features/src/** and samples/** for `extensionSectionComponents: { ... }` registrations, then checks each registered component's own render body for a nested Card/SectionCard/CollapsibleSection — the host (RenderEdit) already frames it in one card, so a second one doubles the border/padding. Registered in run-ui-guards.ts. Per-line override: `// kumiko-lint-ignore no-framed-extension-sections <reason>`.

<!-- kumiko-changes
feature: guards
type: improvement
title: New guard-no-framed-extension-sections flags a registered extension-section component that renders its own Card/SectionCard/CollapsibleSection (fw#3234)
migration: |
  New rule, no baseline — the measured backlog across bundled-features and samples is 0 (notes-section.tsx's own nested cards were dropped as part of this change).
-->
