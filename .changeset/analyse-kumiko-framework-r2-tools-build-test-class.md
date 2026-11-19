---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-dev-server": patch
---
`*.build.integration.test.ts` is its own test class, run by `kumiko-testing integration --build`.
<!-- kumiko-changes
feature: testing
type: improvement
title: Build tests get their own class and budget
detail: Integration tests that run bun install, a build or a Docker image in a subprocess move to `*.build.integration.test.ts`. `kumiko-testing integration` skips them, `kumiko-testing integration --build` runs only them with `TEST_TIMEOUT_MS.build` (180 s), and `test:build` is a known app script. Apps run them in their own CI job instead of the normal integration lane, so a registry stall no longer slows every pull request.
-->
