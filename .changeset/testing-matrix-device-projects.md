---
"@cosmicdrift/kumiko-testing": minor
---

`runMatrix` now supports real device emulation: a Playwright project named after a viewport id (`desktop`, `tablet`, `mobile`) with `use.isMobile: true` captures exactly `<name>.png` at the device's native size instead of looping `setViewportSize`, which would destroy the emulation. Any other project still runs the desktop pass, skipping the viewport ids a device project already covers. Without device projects, nothing changes. `SCREENSHOT_VIEWPORTS` filters both — a filtered-out device project's test is skipped with a reason, not run empty. Device projects using a WebKit device need `bunx playwright install webkit` in CI.

<!-- kumiko-changes
feature: testing
type: improvement
title: runMatrix supports device-emulation Playwright projects for real native-size screenshots
-->
