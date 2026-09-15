# @cosmicdrift/kumiko-repo-manifest

Schema and loader for a repo's `kumiko.json` manifest: repo `kind`
(`framework`/`library`/`app`), source roots, test globs, UI roots and
excludes. Backs guard and tooling scope resolution across Kumiko repos.

Without a `kumiko.json`, `loadRepoManifest(root)` derives a manifest from a
`packages/*/src` or `src/` layout instead of failing.

```ts
import { loadRepoManifest } from "@cosmicdrift/kumiko-repo-manifest";

const { manifest, source } = loadRepoManifest(process.cwd());
```
