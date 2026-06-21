# `scripts/demos/`

Recorded screencasts for marketing + per-feature docs. Each `.ts` file
exports a `DemoDef` (`demo({title, steps})`); the recorder in
`scripts/record-demo.ts` (Iter 2, not yet shipped) walks the steps and
produces a split-screen GIF + captions JSON for the marketing site.

## Status

- **Iter 1 (shipped)** — schema (`step.ts` + `demo.ts`), `01-create-app.ts`
  (the hero demo), and a dry-run validator (`__tests__/dry-run.test.ts`)
  that asserts every demo file parses, has plausible selectors, and ships
  non-empty German + English captions ≤ 60 chars.
- **Iter 2 (shipped)** — `scripts/record-demo.ts` orchestrates tmux
  2-pane layout + Playwright headed chromium + `ffmpeg -f avfoundation`
  → GIF. macOS-only capture pipeline (Plan-Doc D8). Captions get rendered
  as an HTML layer next to the GIF on the marketing site
  (`HeroDemo.astro` in the kumiko-platform repo), not burned into the
  pixels. See [`./RECORDING.md`](./RECORDING.md) for setup + run.

## Adding a demo

```ts
// scripts/demos/02-add-billing.ts
import { demo } from "./demo";
import { step } from "./step";

export default demo({
  title: "add-billing",
  steps: [
    step.cli({ type: "bun add @cosmicdrift/...", caption: { de: "...", en: "..." } }),
    step.browser({ navigate: "http://localhost:3000/billing" }),
    step.editor({ file: "src/features/billing.ts", write: "..." }),
  ],
});
```

Conventions:

- Title is kebab-case, becomes the GIF + captions filename.
- One step per atomic on-screen change. Captions land on the step they
  describe, not the next one.
- Captions are 60 chars or less per language so they fit the overlay.
- Browser selectors prefer `[data-test=…]` over `#id` / `.class` — the
  refactor-survival rate is much higher.
- Editor `file` paths are RELATIVE to the scaffolded app root.

## Dry-run

```sh
bun test scripts/demos/__tests__/dry-run.test.ts
```

Fast unit pass — catches schema drift + obvious typos. The deeper
"selector actually resolves in the running app" check lives in Iter 2's
recorder (it boots the app once, walks every step in headless mode, then
runs the headed recording — no point recording a broken demo).
