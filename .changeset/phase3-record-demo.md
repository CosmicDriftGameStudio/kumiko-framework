---
"@cosmicdrift/kumiko-framework": patch
---

Phase 3 Iter 2 (Plan-Doc D8): `scripts/record-demo.ts` orchestrates the
full macOS recording stack — tmux 2-pane layout, Playwright headed
chromium positioned via osascript, `ffmpeg -f avfoundation` screen
capture, walk DemoDef steps with typing delays for CLI / page actions for
browser / `cat`-into-file for editor, then a palette-tuned `mp4 → gif`
plus first-frame poster. Captions JSON is generated from the captured
step durations so the marketing-site overlay never drifts from the
recording.

Output: `dist/hero-recording/{demo.gif, demo-poster.png, captions.json}`
— copy into `kumiko-platform/apps/marketing/public/hero/` to lift the
draft on PR #250. `scripts/demos/RECORDING.md` carries the brew installs,
Screen-Recording permission prompt, and the cp → push → `gh pr ready`
recipe.

Pure-logic tests (`parseArgs`, `resolveDemoByPrefix`) ship as
`scripts/__tests__/record-demo.test.ts`; the tmux / ffmpeg / Playwright
orchestration is exercised by an actual recording session rather than
mocked.
