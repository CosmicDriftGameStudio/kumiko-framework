---
"@cosmicdrift/kumiko-testing": minor
---

defineAppE2eConfig accepts isolatedSpecs to run state-changing e2e specs serially after the parallel projects.

<!-- kumiko-changes
feature: testing
type: improvement
title: Run e2e specs that change global app state in an isolated project
detail: defineAppE2eConfig takes an isolatedSpecs option with the same pattern form as testMatch. Matching specs are removed from chromium and from every app project and run in a separate chromium-isolated project with one worker, only after all other projects have finished. Apps use it for specs that change state shared across the app, such as creating catalog channels. With isolatedSpecs set, every app project needs a name, and a run with --shard throws because Playwright does not shard dependency projects. Without the option the generated config is unchanged.
-->
