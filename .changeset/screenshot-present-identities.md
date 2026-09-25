---
"@cosmicdrift/kumiko-testing": minor
---

Screenshot runner replaces generated seed identities with presentable values

<!-- kumiko-changes
feature: testing
type: improvement
title: Screenshot runner replaces generated seed identities with presentable values
detail: |
  Seeded identities are unique per run (admin-<tenantId>@…), so screenshots
  showed a different address on every run. A scenario flow now calls
  `presentIdentities([{ from: tenant.admin.email, to: "anna@example.com" }])`
  from its fixtures, and runScreenshots/runMatrix replace `from` with `to` in
  the page's text nodes and input/textarea values right before every capture,
  again after each theme and viewport change. captureScreenshot takes the same
  list as `opts.presentIdentities`. Only the rendered page changes: the seeded
  data, the seed routes and the app UI stay untouched. Code that builds a
  `ScenarioFixtures` object itself (instead of receiving it in a flow) now has
  to pass `presentIdentities` too.
-->
