# Hero-Demo Recording — Copy/Paste Workflow

Voraussetzungen: macOS, tmux, ffmpeg, Playwright chromium, Screen-Recording-Recht für dein Terminal.

**Wichtig:** Nicht aus dem Cursor-Terminal aufnehmen — Fenster stapeln sich sonst. In **Terminal.app** (oder iTerm2) starten:

```sh
cd /Users/marc/code/cosmicdriftgamestudio/.wt/kumiko-framework-demo-kit
```

Der Recorder öffnet links ein **eigenes** Terminal-Fenster (tmux attach), rechts Chromium. Beide werden per osascript nebeneinander gelegt — Cursor/iTerm-Fenster vorher minimieren oder schließen.

Optional: `RECORD_DEMO_TERMINAL=iTerm2` wenn du iTerm statt Terminal.app willst.

Setup-Details: [RECORDING.md](./RECORDING.md)

## 1. DB

```sh
docker compose up -d postgres redis
docker compose exec postgres createdb -U kumiko kumiko_demo_recording 2>/dev/null || true
```

## 2. Workdir leeren

Scaffold heißt `hero-app` und landet in `/tmp/kumiko-hero-recording/` — **nicht** `./demo/` im Repo (der Sample-App-Ordner bleibt unangetastet).

```sh
rm -rf /tmp/kumiko-hero-recording
tmux kill-session -t kumiko-demo 2>/dev/null || true
```

## 3. Aufnehmen

```sh
bun scripts/record-demo.ts
```

Log prüfen: `geometry: … per pane` und `positioned browser … @ <rightX>,…` — rightX muss > 0 sein und Terminal links, Browser rechts sichtbar sein **bevor** die Aufnahme losgeht.

Output: `dist/hero-recording/demo.gif`, `demo-poster.png`, `captions.json`

## 4. Nach Platform PR #250

```sh
cp dist/hero-recording/{demo.gif,demo-poster.png,captions.json} \
  ../kumiko-platform/.wt/kumiko-platform-feat/phase3-hero-demo/apps/marketing/public/hero/

cd ../kumiko-platform/.wt/kumiko-platform-feat/phase3-hero-demo
git add apps/marketing/public/hero/
git commit -m "feat(marketing): hero demo recording"
git push
```
