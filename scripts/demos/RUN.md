# Hero-Demo Recording — Copy/Paste Workflow

Voraussetzungen: macOS, tmux, ffmpeg, Playwright chromium, Screen-Recording-Recht für dein Terminal.

Der Recorder öffnet ein **eigenes** Terminal-Fenster links (tmux attach) — nicht das Fenster, in dem du `bun` startest. Optional: `RECORD_DEMO_TERMINAL=iTerm2`.

Setup-Details: [RECORDING.md](./RECORDING.md)

## 1. DB

```
cd /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit && docker compose up -d
```

## 2. Aufnehmen

```
cd /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit
tmux kill-session -t kumiko-demo 2>/dev/null || true
bun scripts/record-demo.ts
```

Output: `dist/hero-recording/demo.gif`, `demo-poster.png`, `captions.json`

## 3. Nach Platform PR #250

```
cp /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit/dist/hero-recording/demo.gif /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit/dist/hero-recording/demo-poster.png /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit/dist/hero-recording/captions.json /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-platform-feat/phase3-hero-demo/apps/marketing/public/hero/

cd /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-platform-feat/phase3-hero-demo
git add apps/marketing/public/hero/
git status
```

