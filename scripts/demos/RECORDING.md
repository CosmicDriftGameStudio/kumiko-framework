# Recording the hero demo

The `scripts/record-demo.ts` orchestrator drives tmux + Playwright + ffmpeg
to produce `apps/marketing/public/hero/demo.gif` (Plan-Doc D8). macOS only —
the pipeline uses `avfoundation` for screen capture and `osascript` for
window positioning.

## One-time setup

```sh
brew install tmux ffmpeg
bunx playwright install chromium
```

Grant **Screen Recording** permission to the terminal you run `bun` from:
**System Settings → Privacy & Security → Screen Recording → enable
Terminal / iTerm / etc**. The first `ffmpeg avfoundation` capture silently
records a black screen without it.

The recorder opens a **second** window for the CLI pane (left half of the
GIF): by default **Terminal.app** runs `tmux attach -t kumiko-demo`. Your
Cursor/iTerm window where you launched `bun scripts/record-demo.ts` is not
the recorded CLI — watch for the new Terminal window at the top-left.
For iTerm: `RECORD_DEMO_TERMINAL=iTerm2 bun scripts/record-demo.ts`.

Also start the Postgres + Redis stack the scaffolded app boots against. From
this repo:

```sh
docker compose up -d
```

(`bun dev` inside the scaffolded app expects `localhost:5432` + `localhost:6379`.)

## Window geometry

Each pane uses **half the main display visible frame** (NSScreen `visibleFrame` via
osascript) — terminal left, browser right, no overlap. On start the recorder logs:

`geometry: <paneW>×<paneH> per pane, capture <W>×<H> @ (x,y)`

Override for debugging: `RECORD_DEMO_GEOMETRY=1280x720 bun scripts/record-demo.ts`

## Run

```sh
bun scripts/record-demo.ts                 # default: 01-create-app
bun scripts/record-demo.ts --demo=02       # 02-add-billing once it exists
bun scripts/record-demo.ts --dry-run       # walks steps without ffmpeg
```

Output lands in `dist/hero-recording/`:

- `demo.gif` — the actual asset
- `demo-poster.png` — first-frame still (the HeroDemo placeholder)
- `captions.json` — step timecodes + de/en text co-sourced from the
  `step({…, caption: {de, en}})` calls in `scripts/demos/01-create-app.ts`

Don't edit `captions.json` by hand — re-run with the captions changed in
the demo file. The component (`HeroDemo.astro` in kumiko-platform) reads
this JSON at build time and renders captions as an HTML overlay next to the
GIF (Plan-Doc D11: selectable, keyboard-navigable, i18n-friendly).

## Ship

```sh
# from this repo:
cp dist/hero-recording/{demo.gif,demo-poster.png,captions.json} \
   ../kumiko-platform/apps/marketing/public/hero/

cd ../kumiko-platform
git add apps/marketing/public/hero/
git commit -m "feat(marketing): record hero demo (Iter 2)"
git push
gh pr ready 250                            # lift draft
```

Once the GIF is in `public/hero/`, the `HeroDemo.astro` build-time check
swaps the placeholder for the real `<img>` automatically — no Astro edit
needed (Iter 1 baked that branch in).

## Window geometry

Both panes are 1280×720; the combined capture rect is 2560×720, scaled to
1920×540 in the GIF (15fps, palette-tuned to avoid 256-color banding).
`positionWindows()` uses `osascript` to push the front Terminal window to
`(0,0)` and the front Chromium window to `(1280,0)` — re-adjust manually
between `tmuxStart()` and `startCapture()` if you have multiple windows
front-of-stack.

## Troubleshooting

- **`Selected device is not capable`** from ffmpeg → the screen index is
  wrong. Swap `-i "1:none"` for `-i "0:none"`, `-i "2:none"`, etc. List
  available devices: `ffmpeg -f avfoundation -list_devices true -i ""`.
- **black GIF** → Screen Recording permission missing (see setup above).
- **chromium opens behind the terminal** → re-run; `osascript` is racy
  with WindowServer the first 1–2 seconds after a window opens.
- **GIF shows only browser, left half empty** → a detached tmux session was
  typed into with no visible window. Current recorder opens Terminal.app
  (or iTerm2 via `RECORD_DEMO_TERMINAL=iTerm2`) with `tmux attach`. Ensure
  that window sits at the top-left before capture starts; re-run if needed.
- **Browser window wrong size** → Playwright uses "Google Chrome for Testing"
  on macOS (not "Chromium"); recorder positions that process via osascript.
- **tmux session leftover from a crashed run** → `tmux kill-session -t
  kumiko-demo` and retry.
- **timing too tight, captions cut off** → bump the `sleep(2500)` /
  `sleep(1500)` constants in `execute()`. Captions are timed from the
  actual step start/end after recording, so longer sleeps just give the
  viewer more time on screen, not drift.

## Adding more demos

See `scripts/demos/README.md` for the step schema. Each new
`scripts/demos/<N>-<name>.ts` is recorded with
`bun scripts/record-demo.ts --demo=<N>`; output filenames key off the
demo's `title`.



