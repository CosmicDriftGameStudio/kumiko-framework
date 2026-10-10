# @cosmicdrift/kumiko-repo-manifest

## 0.356.0

## 0.355.0

## 0.354.1

## 0.354.0

## 0.353.0

## 0.352.0

## 0.351.0

## 0.350.0

## 0.349.0

## 0.348.1

## 0.348.0

## 0.347.0

## 0.346.0

## 0.345.0

## 0.344.0

## 0.343.0

## 0.342.0

## 0.341.0

## 0.340.0

## 0.339.0

## 0.338.0

### Patch Changes

- c331807: repo-manifest: the root-containment check also resolves wildcard segments. A symlink such as `packages/evil -> /` matched by `packages/*/src` is now rejected; before, only the static prefix before the first glob segment was checked. Segments below a `**` are still not walked, so glob consumers must not follow symlinks inside such a tree.

  <!-- kumiko-changes
  feature: repo-manifest
  type: breaking
  title: manifest patterns reject symlinks escaping the repo root behind wildcard segments
  migration: |
    A kumiko.json whose wildcard pattern matches a symlink that leaves the repo root now fails to load. Point the pattern at paths inside the repo or remove the symlink.
  -->

## 0.337.1

## 0.337.0

## 0.336.1

## 0.336.0

## 0.335.0

### Patch Changes

- 6fee777: `kumiko check` counts a step that throws as a failure and still runs the remaining steps, and `--explain` now returns the guards' exit code. The `agent`, `consumer` and `project` commands report a readable message when `kumiko.config.ts` has no default export with a `features` array instead of crashing. Invalid-manifest errors name the root as `<root>` instead of an empty path.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko check survives throwing steps, config loading validates its shape
  -->

## 0.334.0

## 0.333.0

## 0.332.0

## 0.331.0

## 0.330.2

## 0.330.1

## 0.330.0

## 0.329.0

## 0.328.1

## 0.328.0

## 0.327.0

## 0.326.1

## 0.326.0

## 0.325.2

## 0.325.1

## 0.325.0

## 0.324.0

## 0.323.0

## 0.322.0

## 0.321.0

## 0.320.0

## 0.319.0

## 0.318.0

## 0.317.0

## 0.316.0

## 0.315.0

## 0.314.0

## 0.313.0

## 0.312.0

## 0.311.0

## 0.310.0

## 0.309.0

## 0.308.0

### Patch Changes

- 685ecc9: `import { z } from "zod"` pulled the whole zod namespace — including all 63 locales and the json-schema module — into every client bundle that imported it (359 KB in a publicstatus admin bundle). All framework packages now use `import * as z from "zod"`, which Bun.build can tree-shake (a probe bundle went from 264 KB to 67 KB). A new Biome rule (`noRestrictedImports` on `packages/*/src/**`) keeps `{ z }` from coming back.

  <!-- kumiko-changes
  feature: framework
  type: fix
  title: zod namespace import lets client bundles tree-shake unused locales
  -->

## 0.307.0

## 0.306.0

## 0.305.0

## 0.304.0

## 0.303.0

## 0.302.0

## 0.301.0

## 0.300.0

## 0.299.0

## 0.298.0

## 0.297.0

## 0.296.0

## 0.295.0

## 0.294.1

## 0.294.0

## 0.293.0

## 0.292.0

## 0.291.0

## 0.290.0

## 0.289.0

## 0.288.0

## 0.287.0

## 0.286.0

## 0.285.2

## 0.285.1

## 0.285.0

### Minor Changes

- 8ee38b3: Add a `tooling` repo kind, scoped out of guards by default

  `kumiko-repo-manifest`'s `repoKindSchema` gains a `"tooling"` value for a repo with no product code (infra, Pulumi, build tooling). `kumiko-guards`' `scanRoots` treats an omitted `ScanSpec.kinds` as "every root except tooling" instead of "every root" — only 7 of ~60 guards declare `kinds` today, so without this a tooling repo would have been silently pulled into every product-oriented guard; a guard now has to name `"tooling"` in `kinds` explicitly to scan one. Separately, `kumiko-framework`'s boot-validator now includes the implicit parent-id field in a form screen's `urlPrefillFields` when it's reached via a relatedList toolbarAction that declares no `params` of its own — the renderer already sends that field (`parentFilter.field`, else `parentParam`, else `"id"`), the boot-validator just wasn't allowlisting it.

  <!-- kumiko-changes
  feature: framework
  type: improvement
  title: Add a `tooling` repo kind, scoped out of guards by default
  -->

## 0.284.0

## 0.283.0

## 0.282.0

## 0.281.0

## 0.1.0

### Minor Changes

- 1e185b5: Adds `@cosmicdrift/kumiko-guards`, a public single-repo port of the infra ts-morph security guards (`admin-api`, `direct-entity-writes`, `direct-fetch`, `escape-hatch-declared`, `no-direct-fs`, `open-to-all-reason`, `tenant-escalation`, `access-denied-test`) plus the shared guard-runner, scan-scope and per-repo security-baseline machinery. `@cosmicdrift/kumiko-repo-manifest` extracts the `kumiko.json` manifest schema and loader out of `@cosmicdrift/kumiko-cli` into its own package, since `kumiko-guards` needs it independently of the CLI. `@cosmicdrift/kumiko-cli` keeps its `./repo-manifest` subpath export unchanged, now re-exporting from the new package.
