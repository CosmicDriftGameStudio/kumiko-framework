# @cosmicdrift/kumiko-server-runtime

Production server boot for Kumiko apps: connections, schema drift gate, seeds, lifecycle and graceful shutdown. The prod counterpart to `runDevApp` in `@cosmicdrift/kumiko-dev-server`, without dev, scaffold or codegen tooling.

## Install

```bash
bun add @cosmicdrift/kumiko-server-runtime
```

```ts
import { runProdApp } from "@cosmicdrift/kumiko-server-runtime/run-prod-app";
```

## Bundled read-only assets

Files your own build ships (fonts, templates) are declared in `package.json` next to `kumiko.clientEntries`:

```json
"kumiko": { "assets": [{ "name": "inter-bold.ttf", "source": "packages/site-kit/fonts/inter-bold.ttf" }] }
```

`source` is relative to the app's `package.json` and must stay inside it; `name` matches `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`. `buildProdBundle` copies each asset to `dist/kumiko-bundled-assets/<name>`, a folder the static file server never serves. Read them without `node:fs`:

```ts
import { readBundledAsset } from "@cosmicdrift/kumiko-server-runtime";

const bytes = await readBundledAsset("inter-bold.ttf"); // dist copy in prod, declared source in dev
```

`resolveBundledAsset(name)` returns the absolute path for libraries that only take a path.

Documentation: https://kumiko.rocks
