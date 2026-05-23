---
"@cosmicdrift/kumiko-dev-server": patch
---

`walkthrough.integration.ts` — DX-3.1 walkthrough-snapshot-test. Pins
scaffoldApp + scaffoldAppFeature output gegen die Behauptungen in
docs.kumiko.so/en/walkthrough/. Catches doc-drift ohne actual
`bunx … && yarn install && bun run boot` CI-run.

5 Tests: file-list, auto-mount-diff, run-config text-content,
composeFeatures(includeBundled:true) = 7 features, bin/main auth.admin
stub.
