---
"@cosmicdrift/kumiko-dev-server": minor
---

`scaffoldApp` + `kumiko new app <name>` — DX-1.0 aus DX-Roadmap. Generiert
ein lauffähiges App-Skelett (package.json, tsconfig, run-config mit
secrets+sessions, bin/main.ts mit auth-admin-stub + deterministische
tenant-UUID, .env.example, README) in `<cwd>/<name>/`.

Boot-Pfad: `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` läuft ohne DB/Redis.

Held-back für spätere DX-Phasen: drizzle-setup (DX-1.1, blocked-by DX-4
auto-registry), Dockerfile (existing `kumiko init-deploy`), first feature
scaffold (existing `kumiko create` bzw. DX-2 `kumiko add feature`).

Usage:
```sh
bunx kumiko new app my-shop
cd my-shop && yarn install
cp .env.example .env  # JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 setzen
bun run boot          # → boot validation OK
```
