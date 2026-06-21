---
"@cosmicdrift/kumiko-framework": patch
---

Phase 3 (Plan-Doc `create-kumiko-app.md`) Iter 1: scaffolds the demo
recording pipeline as a schema-first format. `scripts/demos/` carries the
step DSL (`step.cli` / `step.browser` / `step.editor`), the wrapper
(`demo({title, steps})`), the hero demo (`01-create-app.ts`, the
10-step `curl … | bash` → login → add-feature flow), and a unit-level
dry-run validator that pins selector shape + caption length per step.

The actual recorder (`scripts/record-demo.ts`: tmux 2-pane + Playwright
headed + ffmpeg → GIF) and the marketing-site hero (`HeroDemo.astro` +
`captions.json` in kumiko-platform) arrive in Iter 2 alongside the
recording session that produces the first real GIF asset. This package
ships only the schema-side so a follow-up PR can swap in the recorder
without churning the step definitions.
