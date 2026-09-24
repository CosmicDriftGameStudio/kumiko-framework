---
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-testing": patch
---

`createKumikoServer` can now build its client bundle prod-shaped (splitting, no sourcemap, `NODE_ENV=production`) behind the opt-in `KUMIKO_DEV_PROD_BUNDLES` env var — `bun dev` is unaffected. `defineAppE2eConfig` sets it for the Playwright web server, so E2E now exercises the bundle shape that actually ships instead of a single dev bundle with React's development build, every lazy chunk inlined and a regenerated sourcemap per boot (publicstatus admin: 2.2 MB + 9.2 MB map → 0.87 MB entry; E2E suite −15 % on a 1.5 CPU runner).

<!-- kumiko-changes
feature: dev-server
type: improvement
title: Dev server can build prod-shaped client bundles, E2E uses them
-->
