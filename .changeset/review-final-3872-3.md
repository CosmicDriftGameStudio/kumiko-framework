---
"@cosmicdrift/kumiko-testing": minor
---

New `@cosmicdrift/kumiko-testing/helpers/mock-module` with `mockModuleForFile(specifier, realModule, overrides, { restoreOverrides })`: mocks a module with the real exports plus overrides and restores it in `afterAll`.

<!-- kumiko-changes
feature: testing
type: improvement
title: mockModuleForFile restores module mocks automatically
detail: bun's mock.module is process-global, so tests had to copy the real module and restore it by hand in afterAll. The helper does both and can point re-exporting modules back at the real export.
-->
