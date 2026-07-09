# Demo-Kit — Runner außen, Steps nur Nutzdaten

Erweiterung von `kumiko-platform/docs/plans/features/create-kumiko-app.md` (D10/D11).
Issue: [kumiko-framework#563](https://github.com/CosmicDriftGameStudio/kumiko-framework/issues/563)

## Layout

```
scripts/demo-kit/
  engine/           hydrate, validate, CLI (Runner kommen in Phase 2)
  presets/cli.yaml  wiederverwendbare CLI-Makros
  demos/<id>/
    demo.yaml       vars + step-Liste
    steps/*.yaml    je Step nur Nutzdaten
    fixtures/       Dateiinhalte (Editor-Steps referenzieren hierher)
```

## Prinzip

| Schicht | Verantwortung |
|---|---|
| `demos/*/steps/*.yaml` | Was passiert (Nutzdaten) |
| `engine/hydrate.ts` | Presets + Fixtures + `{{vars}}` → `DemoDef` |
| `record-demo.ts` / E2E | Wie es ausgeführt wird (Phase 2: ein `executeStep`) |

Editor-Inhalt **nie** inline in YAML — nur `$fixture:dateiname`.

Captions kommen aus Step-`caption` und werden vom Recorder in `captions.json` geschrieben (nie von Hand).

## Step-Template

Gemeinsame Felder: `id`, `kind`, `caption` (de/en, ≤60), `verify` (`e2e` | `record-only` | `skip`).

- **cli**: `preset` + `args` ODER `command` (roh)
- **editor**: `file` + `content: $fixture:…`
- **browser**: `navigate` / `fill` / `click` / `waitFor`

## Worktrees

Nicht auf `main` arbeiten:

```sh
# Platform PR #250
infra/scripts/wt.sh kumiko-platform feat/phase3-hero-demo
cd .wt/kumiko-platform-feat/phase3-hero-demo

# Framework demo-kit
git -C kumiko-framework worktree add -b feat/demo-kit .wt/kumiko-framework-demo-kit origin/main
cd .wt/kumiko-framework-demo-kit
```

## Phasen

1. **Phase 1 (dieser Branch)** — YAML + hydrate + validate-schema + Fixtures
2. **Phase 2** — `executeStep` shared; `record-demo` + E2E nutzen hydrates Demo
3. **Phase 3** — `validate-stack` (App booten, jeder `verify: e2e`-Step)
4. **Phase 4** — `install.sh --yes`, Notes auto-mount, `[data-test=nav-notes]`
5. **Phase 5** — Recording → `kumiko-platform` PR #250 captions ersetzen
