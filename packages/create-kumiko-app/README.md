# create-kumiko-app

Scaffold a new [Kumiko](https://kumiko.rocks) app in seconds.

```sh
bun create kumiko-app my-app
```

The interactive picker asks which bundled features you want
(auth, multi-tenant, files, notifications, billing, …). Hard dependencies
are resolved automatically — picking `auth-email-password` pulls in
`user` and `tenant` for you.

## Non-interactive

```sh
bun create kumiko-app my-app --yes      # take every recommended feature
bun create kumiko-app --print-manifest  # JSON dump of the picker choices
```

## What lands on disk

`bun create kumiko-app my-app` generates a runnable workspace:

- `package.json` — `@cosmicdrift/kumiko-*` deps pinned to the current release
- `bin/main.ts` — production-bootstrap, calls `runProdApp({ features, … })`
- `src/run-config.ts` — your picked features as `APP_FEATURES`
- `tsconfig.json`, `.env.example`, `README.md`

First boot:

```sh
cd my-app
bun install
cp .env.example .env  # edit JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1
bun run boot
```

## How it stays in sync

The picker reads a vendored copy of `feature-manifest.json` from the
framework's `samples/apps/use-all-bundled` workspace. A CI drift-test
fails if the vendored copy goes stale — run `bun run vendor:manifest`
inside this package to refresh.
