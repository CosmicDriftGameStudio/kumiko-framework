# demo

Scaffolded by `kumiko new app`. Includes a demo **tasks** feature with list +
edit screens, sidebar nav, and seeded rows — `bun dev` shows a working admin UI
after login. Add more features via `bunx @cosmicdrift/kumiko-cli add feature <name>`.

## Mounted features

- `auth-email-password`
- `user`
- `tenant`
- `config`
- `user-profile`
- `user-data-rights`
- `data-retention`
- `compliance-profiles`
- `sessions`
- `delivery`
- `secrets`
- `tasks` (demo — list + edit screens)

Edit `src/run-config.ts` to add bundled features. The demo lives in
`src/features/tasks/`.

## First run (browser)

```sh
bun install
cp .env.example .env
# set JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1 in .env
docker compose up -d   # local Postgres + Redis (skip if you already have them)
bun dev
```

The welcome banner prints the URL (default `http://localhost:4173`) and admin
login. Sign in as `admin@demo.local` / `changeme`, then open **Tasks**
in the sidebar — demo rows are pre-seeded.

## Boot-only smoke (no DB needed)

```sh
bun run boot
```

Runs `KUMIKO_DRY_RUN_ENV=boot bun bin/main.ts` — validates feature composition
+ env schema, exits 0 without touching DB/Redis. Useful in CI.

## Production build + schema

```sh
bun run build          # kumiko-build → dist/ + dist-server/
bun run schema:apply   # apply checked-in kumiko/migrations (needs DATABASE_URL)
bun run start          # runProdApp against dist/
```

After adding entities/features, regenerate migrations:

```sh
bun run schema:generate <name>
```

## Deploy

`deploy/Dockerfile` + `deploy/migrate-step.sh` are scaffolded for container
deploys. Build context = app repo root; migrations ship in `kumiko/migrations/`.

## Architecture

- `src/run-config.ts` — single source of truth: which features your app mounts (`APP_FEATURES`, `HAS_AUTH`).
- `src/features/tasks/` — demo feature (entity + handlers + screens + nav).
- `src/seed.ts` — dev seed for demo tasks (`bun dev` only).
- `kumiko/schema.ts` — same feature set → `ENTITY_METAS` for `kumiko schema`.
- `bin/dev.ts` — dev-server entry (`bun dev`).
- `bin/main.ts` — production-bootstrap (`bun run start`).
- `bin/kumiko.ts` — schema-CLI bundled into `dist-server/kumiko.js`.
- `docker-compose.yml` — local Postgres + Redis for `bun dev`.

For full docs see https://docs.kumiko.rocks.
