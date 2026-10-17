---
"@cosmicdrift/kumiko-types": patch
---

DASHBOARD_STAT_TONES constant and DashboardStatTone type

<!-- kumiko-changes
feature: types
type: improvement
title: DASHBOARD_STAT_TONES is the single source for dashboard stat tones
detail: screen.ts exports DASHBOARD_STAT_TONES and DashboardStatTone; DashboardStatPanel.tone derives from it, and the web renderer builds its runtime tone check and StatTone type from the same constant, so a new tone can no longer be silently dropped from toneField values.
-->
