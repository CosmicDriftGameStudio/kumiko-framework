---
"@cosmicdrift/kumiko-testing": patch
---

Export trackInFlightRequests(page) so captureScreenshot counts requests from the initial load; the first untracked call waits for network idle, and a pushState during a delayed navigation no longer drops in-flight requests

<!-- kumiko-changes
feature: testing
type: improvement
title: trackInFlightRequests(page) export for captureScreenshot
-->
