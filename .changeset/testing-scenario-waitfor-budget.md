---
"@cosmicdrift/kumiko-testing": patch
---

Screenshot scenario `waitFor` uses the template timeout budget (fw#3118)

<!-- kumiko-changes
feature: testing
type: fix
title: Screenshot scenario waitFor uses the template timeout budget instead of a fixed 10s
detail: |
  runScreenshots/runMatrix wait for a scenario's `waitFor` selector with
  `E2E_TIMEOUT_MS.navigation`, or `E2E_TIMEOUT_MS.real` under
  KUMIKO_REAL_PROVIDERS=1, so real-provider screenshot scenarios no longer
  time out on LLM/OCR latency and apps don't need their own wait timeouts.
-->
