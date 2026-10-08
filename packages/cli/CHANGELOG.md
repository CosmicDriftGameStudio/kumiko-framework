# @cosmicdrift/kumiko-cli

## 0.353.0

### Patch Changes

- Updated dependencies [1d1ff03]
- Updated dependencies [4d6ce00]
- Updated dependencies [e1862ae]
- Updated dependencies [e1862ae]
- Updated dependencies [3932e47]
- Updated dependencies [f05c4e7]
- Updated dependencies [8310091]
- Updated dependencies [4ec1c59]
- Updated dependencies [4ec1c59]
- Updated dependencies [0609d09]
- Updated dependencies [649b512]
- Updated dependencies [d32c9b3]
- Updated dependencies [a9ab2be]
- Updated dependencies [b5466a7]
  - @cosmicdrift/kumiko-testing@0.353.0
  - @cosmicdrift/kumiko-bundled-features@0.353.0
  - @cosmicdrift/kumiko-framework@0.353.0
  - @cosmicdrift/kumiko-dev-server@0.353.0
  - @cosmicdrift/kumiko-guards@0.353.0
  - @cosmicdrift/kumiko-repo-manifest@0.353.0

## 0.352.0

### Patch Changes

- Updated dependencies [9fb0657]
- Updated dependencies [c0be608]
- Updated dependencies [9fb0657]
- Updated dependencies [b905d4b]
- Updated dependencies [9fb0657]
- Updated dependencies [fd0a878]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
- Updated dependencies [9fb0657]
  - @cosmicdrift/kumiko-framework@0.352.0
  - @cosmicdrift/kumiko-bundled-features@0.352.0
  - @cosmicdrift/kumiko-guards@0.352.0
  - @cosmicdrift/kumiko-dev-server@0.352.0
  - @cosmicdrift/kumiko-testing@0.352.0
  - @cosmicdrift/kumiko-repo-manifest@0.352.0

## 0.351.0

### Minor Changes

- 44be746: `kumiko-upgrade` ships with kumiko-cli and reads the repo's own version

  Repos that depend only on `@cosmicdrift/kumiko-cli` and `@cosmicdrift/kumiko-guards` now get the `kumiko-upgrade` bin, which the upgrade-state guard runs. The installed version comes from the repo itself: its `node_modules`, the framework's package directories, then its `bun.lock`. It no longer walks up into a parent workspace, and with the isolated linker `installedVersion` is no longer `null`. Changelog entries newer than the installed version are not reported as pending, even when a parent workspace holds a newer install.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko-upgrade ships with kumiko-cli and takes the installed version from the repo's own install or bun.lock
  -->

### Patch Changes

- 44be746: `--help` prints usage on every bin

  `kumiko-init-deploy --help` used to write the deploy files, and `kumiko-testing integration --help` crashed while parsing its arguments. Both now print their usage and exit 0, as do `kumiko-build`, `kumiko-dev`, `kumiko-schema-check` and `create-kumiko-app`.

  <!-- kumiko-changes
  feature: dev-server
  type: fix
  title: --help prints usage instead of running the command (init-deploy, build, dev, schema-check, kumiko-testing integration)
  -->

- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
- Updated dependencies [44be746]
  - @cosmicdrift/kumiko-testing@0.351.0
  - @cosmicdrift/kumiko-dev-server@0.351.0
  - @cosmicdrift/kumiko-framework@0.351.0
  - @cosmicdrift/kumiko-guards@0.351.0
  - @cosmicdrift/kumiko-bundled-features@0.351.0
  - @cosmicdrift/kumiko-repo-manifest@0.351.0

## 0.350.0

### Patch Changes

- Updated dependencies [80ca7d3]
  - @cosmicdrift/kumiko-bundled-features@0.350.0
  - @cosmicdrift/kumiko-dev-server@0.350.0
  - @cosmicdrift/kumiko-testing@0.350.0
  - @cosmicdrift/kumiko-framework@0.350.0
  - @cosmicdrift/kumiko-guards@0.350.0
  - @cosmicdrift/kumiko-repo-manifest@0.350.0

## 0.349.0

### Patch Changes

- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
- Updated dependencies [6e850b8]
  - @cosmicdrift/kumiko-framework@0.349.0
  - @cosmicdrift/kumiko-dev-server@0.349.0
  - @cosmicdrift/kumiko-bundled-features@0.349.0
  - @cosmicdrift/kumiko-testing@0.349.0
  - @cosmicdrift/kumiko-guards@0.349.0
  - @cosmicdrift/kumiko-repo-manifest@0.349.0

## 0.348.1

### Patch Changes

- Updated dependencies [f047a97]
  - @cosmicdrift/kumiko-bundled-features@0.348.1
  - @cosmicdrift/kumiko-dev-server@0.348.1
  - @cosmicdrift/kumiko-testing@0.348.1
  - @cosmicdrift/kumiko-framework@0.348.1
  - @cosmicdrift/kumiko-guards@0.348.1
  - @cosmicdrift/kumiko-repo-manifest@0.348.1

## 0.348.0

### Patch Changes

- Updated dependencies [400490e]
- Updated dependencies [400490e]
- Updated dependencies [d7fd7e0]
  - @cosmicdrift/kumiko-bundled-features@0.348.0
  - @cosmicdrift/kumiko-framework@0.348.0
  - @cosmicdrift/kumiko-testing@0.348.0
  - @cosmicdrift/kumiko-dev-server@0.348.0
  - @cosmicdrift/kumiko-guards@0.348.0
  - @cosmicdrift/kumiko-repo-manifest@0.348.0

## 0.347.0

### Patch Changes

- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [a35ad24]
- Updated dependencies [69c182c]
- Updated dependencies [69c182c]
  - @cosmicdrift/kumiko-bundled-features@0.347.0
  - @cosmicdrift/kumiko-dev-server@0.347.0
  - @cosmicdrift/kumiko-framework@0.347.0
  - @cosmicdrift/kumiko-guards@0.347.0
  - @cosmicdrift/kumiko-testing@0.347.0
  - @cosmicdrift/kumiko-repo-manifest@0.347.0

## 0.346.0

### Patch Changes

- Updated dependencies [7bade44]
- Updated dependencies [c4a4bba]
- Updated dependencies [d83aa55]
- Updated dependencies [695d47c]
- Updated dependencies [0207a6e]
- Updated dependencies [6b8dde4]
  - @cosmicdrift/kumiko-bundled-features@0.346.0
  - @cosmicdrift/kumiko-framework@0.346.0
  - @cosmicdrift/kumiko-dev-server@0.346.0
  - @cosmicdrift/kumiko-testing@0.346.0
  - @cosmicdrift/kumiko-guards@0.346.0
  - @cosmicdrift/kumiko-repo-manifest@0.346.0

## 0.345.0

### Patch Changes

- Updated dependencies [cef5fa0]
- Updated dependencies [c325eb2]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [07495cf]
- Updated dependencies [c325eb2]
- Updated dependencies [c325eb2]
- Updated dependencies [db68d67]
  - @cosmicdrift/kumiko-framework@0.345.0
  - @cosmicdrift/kumiko-bundled-features@0.345.0
  - @cosmicdrift/kumiko-dev-server@0.345.0
  - @cosmicdrift/kumiko-testing@0.345.0
  - @cosmicdrift/kumiko-guards@0.345.0
  - @cosmicdrift/kumiko-repo-manifest@0.345.0

## 0.344.0

### Patch Changes

- Updated dependencies [2a07102]
- Updated dependencies [2a07102]
- Updated dependencies [2a07102]
  - @cosmicdrift/kumiko-bundled-features@0.344.0
  - @cosmicdrift/kumiko-dev-server@0.344.0
  - @cosmicdrift/kumiko-testing@0.344.0
  - @cosmicdrift/kumiko-framework@0.344.0
  - @cosmicdrift/kumiko-guards@0.344.0
  - @cosmicdrift/kumiko-repo-manifest@0.344.0

## 0.343.0

### Patch Changes

- Updated dependencies [23b0bec]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [75cb7c0]
- Updated dependencies [cf6d31b]
- Updated dependencies [cf6d31b]
- Updated dependencies [75cb7c0]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [446b714]
- Updated dependencies [d32e123]
- Updated dependencies [6adca33]
- Updated dependencies [cf6d31b]
- Updated dependencies [cf6d31b]
- Updated dependencies [446b714]
  - @cosmicdrift/kumiko-framework@0.343.0
  - @cosmicdrift/kumiko-bundled-features@0.343.0
  - @cosmicdrift/kumiko-dev-server@0.343.0
  - @cosmicdrift/kumiko-testing@0.343.0
  - @cosmicdrift/kumiko-guards@0.343.0
  - @cosmicdrift/kumiko-repo-manifest@0.343.0

## 0.342.0

### Minor Changes

- e7f2d36: `kumiko check` fails a kind "app" without uiRoots

  A repo with `kind: "app"` and no `uiRoots` used to skip the UI guards silently. `kumiko check` (also with `--explain`) now prints an error and exits 1 before any step runs. Declare `uiRoots`, or set `uiRoots: []` for an app without UI; the step list then shows that the UI guards are skipped on purpose. A repo that relies on the derived manifest also gets the hint to add a `kumiko.json`. Other kinds are unchanged. `kumiko new app` now writes a `kumiko.json` with `uiRoots: ["src/features/*/web"]`.

  <!-- kumiko-changes
  feature: cli
  type: breaking
  title: kumiko check requires uiRoots for kind "app"
  migration: |
    Add `uiRoots` to the `kumiko.json` of every `kind: "app"` repo, for example `["src/app", "src/features/*/web"]`, or `[]` for an app without UI. A repo without a `kumiko.json` needs one first, since the derived manifest cannot declare uiRoots.
    Workspace state at release: kumiko-platform, offlot-app, phronexsis and show-pony declare `kind: "app"` without `uiRoots`.
  -->

### Patch Changes

- Updated dependencies [e7f2d36]
- Updated dependencies [5733150]
- Updated dependencies [e7f2d36]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [e7f2d36]
- Updated dependencies [0978e85]
- Updated dependencies [0978e85]
- Updated dependencies [bb89ab6]
  - @cosmicdrift/kumiko-bundled-features@0.342.0
  - @cosmicdrift/kumiko-testing@0.342.0
  - @cosmicdrift/kumiko-dev-server@0.342.0
  - @cosmicdrift/kumiko-framework@0.342.0
  - @cosmicdrift/kumiko-guards@0.342.0
  - @cosmicdrift/kumiko-repo-manifest@0.342.0

## 0.341.0

### Patch Changes

- Updated dependencies [9bc1069]
- Updated dependencies [e7dbdb6]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [610201f]
- Updated dependencies [c5a7dc2]
- Updated dependencies [82309a5]
- Updated dependencies [9bc1069]
- Updated dependencies [465e14c]
- Updated dependencies [1feae69]
- Updated dependencies [fcd9081]
- Updated dependencies [c2c7862]
- Updated dependencies [1feae69]
- Updated dependencies [1feae69]
- Updated dependencies [610201f]
- Updated dependencies [37c0974]
- Updated dependencies [e7dbdb6]
- Updated dependencies [1feae69]
- Updated dependencies [dba5100]
- Updated dependencies [c5e6814]
- Updated dependencies [8443f22]
- Updated dependencies [1f0a63b]
- Updated dependencies [0600763]
- Updated dependencies [e0c2320]
- Updated dependencies [4b01c83]
- Updated dependencies [37c0974]
  - @cosmicdrift/kumiko-bundled-features@0.341.0
  - @cosmicdrift/kumiko-framework@0.341.0
  - @cosmicdrift/kumiko-dev-server@0.341.0
  - @cosmicdrift/kumiko-guards@0.341.0
  - @cosmicdrift/kumiko-testing@0.341.0
  - @cosmicdrift/kumiko-repo-manifest@0.341.0

## 0.340.0

### Patch Changes

- Updated dependencies [483bb16]
- Updated dependencies [483bb16]
- Updated dependencies [483bb16]
- Updated dependencies [b71234a]
  - @cosmicdrift/kumiko-framework@0.340.0
  - @cosmicdrift/kumiko-bundled-features@0.340.0
  - @cosmicdrift/kumiko-guards@0.340.0
  - @cosmicdrift/kumiko-dev-server@0.340.0
  - @cosmicdrift/kumiko-testing@0.340.0
  - @cosmicdrift/kumiko-repo-manifest@0.340.0

## 0.339.0

### Patch Changes

- Updated dependencies [8b3228a]
- Updated dependencies [d4872a8]
- Updated dependencies [0e065d2]
- Updated dependencies [80ecf93]
- Updated dependencies [5b6e5f7]
- Updated dependencies [4495f98]
- Updated dependencies [c1e6186]
- Updated dependencies [096abc1]
- Updated dependencies [58dd1cb]
- Updated dependencies [fcbf184]
- Updated dependencies [e3adda3]
- Updated dependencies [dc3a61e]
- Updated dependencies [1954386]
- Updated dependencies [b040ca7]
- Updated dependencies [252f749]
  - @cosmicdrift/kumiko-bundled-features@0.339.0
  - @cosmicdrift/kumiko-framework@0.339.0
  - @cosmicdrift/kumiko-guards@0.339.0
  - @cosmicdrift/kumiko-testing@0.339.0
  - @cosmicdrift/kumiko-dev-server@0.339.0
  - @cosmicdrift/kumiko-repo-manifest@0.339.0

## 0.338.0

### Patch Changes

- Updated dependencies [e5c62d2]
- Updated dependencies [e5c62d2]
- Updated dependencies [e234ce6]
- Updated dependencies [9fa543d]
- Updated dependencies [6016fa6]
- Updated dependencies [fcaebd3]
- Updated dependencies [81bafe8]
- Updated dependencies [39b8cd4]
- Updated dependencies [6c1c880]
- Updated dependencies [6c1c880]
- Updated dependencies [421334d]
- Updated dependencies [c710f1e]
- Updated dependencies [1522b9e]
- Updated dependencies [3613e5a]
- Updated dependencies [ca99e95]
- Updated dependencies [916c6c0]
- Updated dependencies [c8ca453]
- Updated dependencies [3451156]
- Updated dependencies [4a13a0e]
- Updated dependencies [7042edb]
- Updated dependencies [57467b5]
- Updated dependencies [a71189f]
- Updated dependencies [43dfcf4]
- Updated dependencies [e8e5e2f]
- Updated dependencies [c331807]
- Updated dependencies [bac056f]
- Updated dependencies [f4f3d4a]
- Updated dependencies [b036209]
- Updated dependencies [87938e0]
- Updated dependencies [51b4867]
- Updated dependencies [4c168d6]
- Updated dependencies [d1bba78]
  - @cosmicdrift/kumiko-bundled-features@0.338.0
  - @cosmicdrift/kumiko-framework@0.338.0
  - @cosmicdrift/kumiko-dev-server@0.338.0
  - @cosmicdrift/kumiko-repo-manifest@0.338.0
  - @cosmicdrift/kumiko-testing@0.338.0
  - @cosmicdrift/kumiko-guards@0.338.0

## 0.337.1

### Patch Changes

- Updated dependencies [b1b01b8]
- Updated dependencies [9074b71]
- Updated dependencies [6c1c1d4]
  - @cosmicdrift/kumiko-framework@0.337.1
  - @cosmicdrift/kumiko-dev-server@0.337.1
  - @cosmicdrift/kumiko-bundled-features@0.337.1
  - @cosmicdrift/kumiko-testing@0.337.1
  - @cosmicdrift/kumiko-guards@0.337.1
  - @cosmicdrift/kumiko-repo-manifest@0.337.1

## 0.337.0

### Patch Changes

- c508752: `kumiko project` and `kumiko consumer` now reject an unknown or missing subcommand with the usage text before importing the config or touching the database. A failing state-table DDL no longer leaks the connection pool and is reported as an error with exit code 1.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: project and consumer validate the subcommand before any database work
  -->

- Updated dependencies [c68ebb6]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [3ad5398]
- Updated dependencies [a7fcca9]
- Updated dependencies [469df86]
- Updated dependencies [7bd2624]
- Updated dependencies [8b6daed]
- Updated dependencies [c2da99c]
- Updated dependencies [7949847]
- Updated dependencies [a5023de]
- Updated dependencies [edc2b80]
- Updated dependencies [b402850]
- Updated dependencies [7735806]
- Updated dependencies [615109d]
- Updated dependencies [8a4feff]
- Updated dependencies [d25d363]
- Updated dependencies [d2737f9]
- Updated dependencies [acde687]
- Updated dependencies [e889f3f]
  - @cosmicdrift/kumiko-framework@0.337.0
  - @cosmicdrift/kumiko-bundled-features@0.337.0
  - @cosmicdrift/kumiko-testing@0.337.0
  - @cosmicdrift/kumiko-dev-server@0.337.0
  - @cosmicdrift/kumiko-guards@0.337.0
  - @cosmicdrift/kumiko-repo-manifest@0.337.0

## 0.336.1

### Patch Changes

- Updated dependencies [ad3999e]
- Updated dependencies [0dd3b1e]
- Updated dependencies [4554270]
- Updated dependencies [c4a1155]
- Updated dependencies [c4a1155]
  - @cosmicdrift/kumiko-framework@0.336.1
  - @cosmicdrift/kumiko-bundled-features@0.336.1
  - @cosmicdrift/kumiko-testing@0.336.1
  - @cosmicdrift/kumiko-dev-server@0.336.1
  - @cosmicdrift/kumiko-guards@0.336.1
  - @cosmicdrift/kumiko-repo-manifest@0.336.1

## 0.336.0

### Patch Changes

- Updated dependencies [e91de78]
- Updated dependencies [e19453a]
- Updated dependencies [d850929]
- Updated dependencies [c2e04a4]
- Updated dependencies [63f7b52]
- Updated dependencies [83378b1]
- Updated dependencies [c95f017]
- Updated dependencies [f0b4aa1]
- Updated dependencies [f124575]
- Updated dependencies [58154f0]
- Updated dependencies [b83c348]
- Updated dependencies [4618e1d]
- Updated dependencies [7d5428e]
  - @cosmicdrift/kumiko-framework@0.336.0
  - @cosmicdrift/kumiko-bundled-features@0.336.0
  - @cosmicdrift/kumiko-guards@0.336.0
  - @cosmicdrift/kumiko-dev-server@0.336.0
  - @cosmicdrift/kumiko-testing@0.336.0
  - @cosmicdrift/kumiko-repo-manifest@0.336.0

## 0.335.0

### Patch Changes

- 0ae79d4: `kumiko check` now runs the boot validation against the repo root instead of the current directory, so running it from a subdirectory no longer reports a missing `kumiko/schema.ts`.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko check runs boot validation against the repo root when started from a subdirectory
  -->

- 6fee777: `kumiko check` counts a step that throws as a failure and still runs the remaining steps, and `--explain` now returns the guards' exit code. The `agent`, `consumer` and `project` commands report a readable message when `kumiko.config.ts` has no default export with a `features` array instead of crashing. Invalid-manifest errors name the root as `<root>` instead of an empty path.

  <!-- kumiko-changes
  feature: cli
  type: fix
  title: kumiko check survives throwing steps, config loading validates its shape
  -->

- Updated dependencies [ff1dea2]
- Updated dependencies [d973444]
- Updated dependencies [a4fa088]
- Updated dependencies [75e8ae1]
- Updated dependencies [ed072dc]
- Updated dependencies [ddb0101]
- Updated dependencies [eb04da6]
- Updated dependencies [44c5898]
- Updated dependencies [07ddc7e]
- Updated dependencies [2477f3b]
- Updated dependencies [c97a39a]
- Updated dependencies [bf12ac5]
- Updated dependencies [6d4068f]
- Updated dependencies [736dade]
- Updated dependencies [561cec5]
- Updated dependencies [2477f3b]
- Updated dependencies [1e9cc86]
- Updated dependencies [099f406]
- Updated dependencies [6fee777]
- Updated dependencies [0ae79d4]
- Updated dependencies [6fee777]
- Updated dependencies [1da9e2c]
- Updated dependencies [57f0e78]
- Updated dependencies [9061d9e]
- Updated dependencies [f63b179]
- Updated dependencies [57f0e78]
- Updated dependencies [099f406]
- Updated dependencies [a86aa83]
- Updated dependencies [692718f]
- Updated dependencies [f86bcd2]
- Updated dependencies [a8f5305]
- Updated dependencies [0705037]
- Updated dependencies [4805c38]
- Updated dependencies [4f6e8d7]
- Updated dependencies [099f406]
- Updated dependencies [70aa253]
- Updated dependencies [837245e]
- Updated dependencies [70aa253]
- Updated dependencies [5b6f9da]
- Updated dependencies [4805c38]
- Updated dependencies [9222a01]
- Updated dependencies [4805c38]
- Updated dependencies [c791abd]
- Updated dependencies [782fdea]
- Updated dependencies [0191e3e]
- Updated dependencies [b18daf9]
- Updated dependencies [c791abd]
- Updated dependencies [04d0ae3]
- Updated dependencies [4b2c300]
- Updated dependencies [ff29a06]
- Updated dependencies [dae5a21]
- Updated dependencies [67703a0]
- Updated dependencies [e810c7d]
- Updated dependencies [567a4bd]
- Updated dependencies [e0e09b0]
- Updated dependencies [f5ff653]
- Updated dependencies [5bca19c]
- Updated dependencies [85dead2]
- Updated dependencies [9acf185]
- Updated dependencies [d7d5bd7]
- Updated dependencies [6990b9b]
- Updated dependencies [57f0e78]
- Updated dependencies [4b2c300]
- Updated dependencies [173a581]
- Updated dependencies [5e9cc10]
- Updated dependencies [4b2c300]
- Updated dependencies [1e25ae5]
- Updated dependencies [a86aa83]
- Updated dependencies [a39d8a6]
- Updated dependencies [9061d9e]
- Updated dependencies [e550021]
- Updated dependencies [6fee777]
- Updated dependencies [a8c0abd]
- Updated dependencies [8a49831]
- Updated dependencies [4e617da]
- Updated dependencies [3d37d50]
- Updated dependencies [f65697d]
- Updated dependencies [7cdc623]
  - @cosmicdrift/kumiko-framework@0.335.0
  - @cosmicdrift/kumiko-bundled-features@0.335.0
  - @cosmicdrift/kumiko-guards@0.335.0
  - @cosmicdrift/kumiko-dev-server@0.335.0
  - @cosmicdrift/kumiko-repo-manifest@0.335.0
  - @cosmicdrift/kumiko-testing@0.335.0

## 0.334.0

### Patch Changes

- Updated dependencies [6633f59]
- Updated dependencies [6633f59]
- Updated dependencies [bc0172a]
  - @cosmicdrift/kumiko-framework@0.334.0
  - @cosmicdrift/kumiko-bundled-features@0.334.0
  - @cosmicdrift/kumiko-dev-server@0.334.0
  - @cosmicdrift/kumiko-testing@0.334.0
  - @cosmicdrift/kumiko-guards@0.334.0
  - @cosmicdrift/kumiko-repo-manifest@0.334.0

## 0.333.0

### Patch Changes

- Updated dependencies [2d7f76f]
- Updated dependencies [90420cb]
  - @cosmicdrift/kumiko-framework@0.333.0
  - @cosmicdrift/kumiko-bundled-features@0.333.0
  - @cosmicdrift/kumiko-testing@0.333.0
  - @cosmicdrift/kumiko-dev-server@0.333.0
  - @cosmicdrift/kumiko-guards@0.333.0
  - @cosmicdrift/kumiko-repo-manifest@0.333.0

## 0.332.0

### Patch Changes

- Updated dependencies [991ed87]
- Updated dependencies [dcf135e]
- Updated dependencies [3917e63]
- Updated dependencies [b81f794]
- Updated dependencies [dcf135e]
- Updated dependencies [541d24b]
- Updated dependencies [e82b023]
- Updated dependencies [dcf135e]
- Updated dependencies [3917e63]
- Updated dependencies [dcf135e]
- Updated dependencies [7b67f69]
- Updated dependencies [563b80e]
- Updated dependencies [3786597]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
- Updated dependencies [1201fcc]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
- Updated dependencies [dcf135e]
  - @cosmicdrift/kumiko-framework@0.332.0
  - @cosmicdrift/kumiko-guards@0.332.0
  - @cosmicdrift/kumiko-bundled-features@0.332.0
  - @cosmicdrift/kumiko-dev-server@0.332.0
  - @cosmicdrift/kumiko-testing@0.332.0
  - @cosmicdrift/kumiko-repo-manifest@0.332.0

## 0.331.0

### Patch Changes

- Updated dependencies [16797a4]
- Updated dependencies [6b95958]
- Updated dependencies [069cbba]
- Updated dependencies [e6b971c]
- Updated dependencies [3ea4ffc]
- Updated dependencies [e4ea9f0]
  - @cosmicdrift/kumiko-framework@0.331.0
  - @cosmicdrift/kumiko-guards@0.331.0
  - @cosmicdrift/kumiko-bundled-features@0.331.0
  - @cosmicdrift/kumiko-dev-server@0.331.0
  - @cosmicdrift/kumiko-testing@0.331.0
  - @cosmicdrift/kumiko-repo-manifest@0.331.0

## 0.330.2

### Patch Changes

- Updated dependencies [32a6102]
  - @cosmicdrift/kumiko-framework@0.330.2
  - @cosmicdrift/kumiko-bundled-features@0.330.2
  - @cosmicdrift/kumiko-dev-server@0.330.2
  - @cosmicdrift/kumiko-testing@0.330.2
  - @cosmicdrift/kumiko-guards@0.330.2
  - @cosmicdrift/kumiko-repo-manifest@0.330.2

## 0.330.1

### Patch Changes

- Updated dependencies [63a63d6]
- Updated dependencies [39c2fbd]
- Updated dependencies [03ad4bc]
  - @cosmicdrift/kumiko-framework@0.330.1
  - @cosmicdrift/kumiko-bundled-features@0.330.1
  - @cosmicdrift/kumiko-dev-server@0.330.1
  - @cosmicdrift/kumiko-testing@0.330.1
  - @cosmicdrift/kumiko-guards@0.330.1
  - @cosmicdrift/kumiko-repo-manifest@0.330.1

## 0.330.0

### Patch Changes

- Updated dependencies [7a886f1]
- Updated dependencies [dc5981b]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [89e32ce]
- Updated dependencies [89e32ce]
- Updated dependencies [7a886f1]
- Updated dependencies [f19fb5c]
- Updated dependencies [1e18129]
- Updated dependencies [1e18129]
- Updated dependencies [48f36df]
- Updated dependencies [89e32ce]
  - @cosmicdrift/kumiko-bundled-features@0.330.0
  - @cosmicdrift/kumiko-framework@0.330.0
  - @cosmicdrift/kumiko-dev-server@0.330.0
  - @cosmicdrift/kumiko-testing@0.330.0
  - @cosmicdrift/kumiko-guards@0.330.0
  - @cosmicdrift/kumiko-repo-manifest@0.330.0

## 0.329.0

### Patch Changes

- Updated dependencies [80ccc38]
- Updated dependencies [9bbdb64]
- Updated dependencies [9bbdb64]
  - @cosmicdrift/kumiko-bundled-features@0.329.0
  - @cosmicdrift/kumiko-testing@0.329.0
  - @cosmicdrift/kumiko-framework@0.329.0
  - @cosmicdrift/kumiko-dev-server@0.329.0
  - @cosmicdrift/kumiko-guards@0.329.0
  - @cosmicdrift/kumiko-repo-manifest@0.329.0

## 0.328.1

### Patch Changes

- Updated dependencies [863e8e4]
- Updated dependencies [86451dd]
  - @cosmicdrift/kumiko-framework@0.328.1
  - @cosmicdrift/kumiko-bundled-features@0.328.1
  - @cosmicdrift/kumiko-dev-server@0.328.1
  - @cosmicdrift/kumiko-testing@0.328.1
  - @cosmicdrift/kumiko-guards@0.328.1
  - @cosmicdrift/kumiko-repo-manifest@0.328.1

## 0.328.0

### Patch Changes

- Updated dependencies [424f49a]
- Updated dependencies [eae8d2b]
- Updated dependencies [9cc1787]
- Updated dependencies [2a4350b]
- Updated dependencies [c3fbe54]
- Updated dependencies [822928f]
  - @cosmicdrift/kumiko-framework@0.328.0
  - @cosmicdrift/kumiko-bundled-features@0.328.0
  - @cosmicdrift/kumiko-dev-server@0.328.0
  - @cosmicdrift/kumiko-testing@0.328.0
  - @cosmicdrift/kumiko-guards@0.328.0
  - @cosmicdrift/kumiko-repo-manifest@0.328.0

## 0.327.0

### Patch Changes

- Updated dependencies [7341d07]
- Updated dependencies [268c3bd]
- Updated dependencies [532a197]
- Updated dependencies [793a00a]
- Updated dependencies [eef5a2f]
- Updated dependencies [da6e569]
  - @cosmicdrift/kumiko-framework@0.327.0
  - @cosmicdrift/kumiko-dev-server@0.327.0
  - @cosmicdrift/kumiko-guards@0.327.0
  - @cosmicdrift/kumiko-bundled-features@0.327.0
  - @cosmicdrift/kumiko-testing@0.327.0
  - @cosmicdrift/kumiko-repo-manifest@0.327.0

## 0.326.1

### Patch Changes

- Updated dependencies [a5e987e]
  - @cosmicdrift/kumiko-bundled-features@0.326.1
  - @cosmicdrift/kumiko-dev-server@0.326.1
  - @cosmicdrift/kumiko-testing@0.326.1
  - @cosmicdrift/kumiko-framework@0.326.1
  - @cosmicdrift/kumiko-guards@0.326.1
  - @cosmicdrift/kumiko-repo-manifest@0.326.1

## 0.326.0

### Patch Changes

- Updated dependencies [6af6be2]
  - @cosmicdrift/kumiko-framework@0.326.0
  - @cosmicdrift/kumiko-bundled-features@0.326.0
  - @cosmicdrift/kumiko-dev-server@0.326.0
  - @cosmicdrift/kumiko-testing@0.326.0
  - @cosmicdrift/kumiko-guards@0.326.0
  - @cosmicdrift/kumiko-repo-manifest@0.326.0

## 0.325.2

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.325.2
- @cosmicdrift/kumiko-dev-server@0.325.2
- @cosmicdrift/kumiko-testing@0.325.2
- @cosmicdrift/kumiko-framework@0.325.2
- @cosmicdrift/kumiko-guards@0.325.2
- @cosmicdrift/kumiko-repo-manifest@0.325.2

## 0.325.1

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.325.1
- @cosmicdrift/kumiko-dev-server@0.325.1
- @cosmicdrift/kumiko-testing@0.325.1
- @cosmicdrift/kumiko-framework@0.325.1
- @cosmicdrift/kumiko-guards@0.325.1
- @cosmicdrift/kumiko-repo-manifest@0.325.1

## 0.325.0

### Patch Changes

- Updated dependencies [100732a]
  - @cosmicdrift/kumiko-framework@0.325.0
  - @cosmicdrift/kumiko-bundled-features@0.325.0
  - @cosmicdrift/kumiko-dev-server@0.325.0
  - @cosmicdrift/kumiko-testing@0.325.0
  - @cosmicdrift/kumiko-guards@0.325.0
  - @cosmicdrift/kumiko-repo-manifest@0.325.0

## 0.324.0

### Patch Changes

- Updated dependencies [efa4114]
- Updated dependencies [b99dde6]
- Updated dependencies [3c0095d]
  - @cosmicdrift/kumiko-framework@0.324.0
  - @cosmicdrift/kumiko-guards@0.324.0
  - @cosmicdrift/kumiko-bundled-features@0.324.0
  - @cosmicdrift/kumiko-dev-server@0.324.0
  - @cosmicdrift/kumiko-testing@0.324.0
  - @cosmicdrift/kumiko-repo-manifest@0.324.0

## 0.323.0

### Patch Changes

- Updated dependencies [d7bba26]
- Updated dependencies [d7bba26]
- Updated dependencies [c01b9be]
- Updated dependencies [5c7e422]
- Updated dependencies [d7bba26]
- Updated dependencies [60e1a1f]
- Updated dependencies [d7bba26]
- Updated dependencies [30bb3b2]
- Updated dependencies [72727cd]
- Updated dependencies [1343b18]
  - @cosmicdrift/kumiko-bundled-features@0.323.0
  - @cosmicdrift/kumiko-dev-server@0.323.0
  - @cosmicdrift/kumiko-framework@0.323.0
  - @cosmicdrift/kumiko-guards@0.323.0
  - @cosmicdrift/kumiko-testing@0.323.0
  - @cosmicdrift/kumiko-repo-manifest@0.323.0

## 0.322.0

### Patch Changes

- Updated dependencies [d0c631a]
- Updated dependencies [9e7bedc]
  - @cosmicdrift/kumiko-framework@0.322.0
  - @cosmicdrift/kumiko-bundled-features@0.322.0
  - @cosmicdrift/kumiko-dev-server@0.322.0
  - @cosmicdrift/kumiko-testing@0.322.0
  - @cosmicdrift/kumiko-guards@0.322.0
  - @cosmicdrift/kumiko-repo-manifest@0.322.0

## 0.321.0

### Patch Changes

- Updated dependencies [959b3fb]
- Updated dependencies [c8c629f]
- Updated dependencies [fa27809]
- Updated dependencies [de9ee46]
- Updated dependencies [fa27809]
- Updated dependencies [8246f13]
- Updated dependencies [b74db24]
- Updated dependencies [5616ad9]
- Updated dependencies [fa27809]
  - @cosmicdrift/kumiko-bundled-features@0.321.0
  - @cosmicdrift/kumiko-testing@0.321.0
  - @cosmicdrift/kumiko-dev-server@0.321.0
  - @cosmicdrift/kumiko-framework@0.321.0
  - @cosmicdrift/kumiko-guards@0.321.0
  - @cosmicdrift/kumiko-repo-manifest@0.321.0

## 0.320.0

### Patch Changes

- Updated dependencies [c61cc7a]
- Updated dependencies [0ab9874]
- Updated dependencies [c61cc7a]
- Updated dependencies [e7cd1cb]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [519261d]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [3a99ac1]
- Updated dependencies [fe36eeb]
- Updated dependencies [02cc7b3]
- Updated dependencies [c498565]
- Updated dependencies [9c6173d]
- Updated dependencies [9907bc6]
- Updated dependencies [ef64fa9]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
- Updated dependencies [c61cc7a]
  - @cosmicdrift/kumiko-bundled-features@0.320.0
  - @cosmicdrift/kumiko-framework@0.320.0
  - @cosmicdrift/kumiko-dev-server@0.320.0
  - @cosmicdrift/kumiko-testing@0.320.0
  - @cosmicdrift/kumiko-guards@0.320.0
  - @cosmicdrift/kumiko-repo-manifest@0.320.0

## 0.319.0

### Patch Changes

- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
- Updated dependencies [53c5206]
  - @cosmicdrift/kumiko-bundled-features@0.319.0
  - @cosmicdrift/kumiko-dev-server@0.319.0
  - @cosmicdrift/kumiko-testing@0.319.0
  - @cosmicdrift/kumiko-framework@0.319.0
  - @cosmicdrift/kumiko-guards@0.319.0
  - @cosmicdrift/kumiko-repo-manifest@0.319.0

## 0.318.0

### Patch Changes

- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [5d3b3e8]
- Updated dependencies [5d3b3e8]
- Updated dependencies [4fac08d]
- Updated dependencies [1d97d7a]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
- Updated dependencies [4c5152f]
  - @cosmicdrift/kumiko-bundled-features@0.318.0
  - @cosmicdrift/kumiko-framework@0.318.0
  - @cosmicdrift/kumiko-testing@0.318.0
  - @cosmicdrift/kumiko-dev-server@0.318.0
  - @cosmicdrift/kumiko-guards@0.318.0
  - @cosmicdrift/kumiko-repo-manifest@0.318.0

## 0.317.0

### Patch Changes

- Updated dependencies [fd40653]
- Updated dependencies [94ce380]
- Updated dependencies [fd40653]
- Updated dependencies [061ee8f]
- Updated dependencies [b13c820]
- Updated dependencies [94ce380]
- Updated dependencies [b71a8fe]
  - @cosmicdrift/kumiko-testing@0.317.0
  - @cosmicdrift/kumiko-bundled-features@0.317.0
  - @cosmicdrift/kumiko-framework@0.317.0
  - @cosmicdrift/kumiko-guards@0.317.0
  - @cosmicdrift/kumiko-dev-server@0.317.0
  - @cosmicdrift/kumiko-repo-manifest@0.317.0

## 0.316.0

### Patch Changes

- Updated dependencies [146324f]
- Updated dependencies [aa32979]
- Updated dependencies [aa32979]
- Updated dependencies [aa32979]
  - @cosmicdrift/kumiko-testing@0.316.0
  - @cosmicdrift/kumiko-framework@0.316.0
  - @cosmicdrift/kumiko-bundled-features@0.316.0
  - @cosmicdrift/kumiko-dev-server@0.316.0
  - @cosmicdrift/kumiko-guards@0.316.0
  - @cosmicdrift/kumiko-repo-manifest@0.316.0

## 0.315.0

### Patch Changes

- Updated dependencies [55b8505]
- Updated dependencies [4cc60bf]
- Updated dependencies [9635e86]
- Updated dependencies [0f2643d]
  - @cosmicdrift/kumiko-bundled-features@0.315.0
  - @cosmicdrift/kumiko-framework@0.315.0
  - @cosmicdrift/kumiko-dev-server@0.315.0
  - @cosmicdrift/kumiko-testing@0.315.0
  - @cosmicdrift/kumiko-guards@0.315.0
  - @cosmicdrift/kumiko-repo-manifest@0.315.0

## 0.314.0

### Patch Changes

- Updated dependencies [483666f]
- Updated dependencies [22d89ec]
- Updated dependencies [483666f]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
- Updated dependencies [483666f]
- Updated dependencies [c3df63c]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
- Updated dependencies [3434a94]
  - @cosmicdrift/kumiko-framework@0.314.0
  - @cosmicdrift/kumiko-testing@0.314.0
  - @cosmicdrift/kumiko-bundled-features@0.314.0
  - @cosmicdrift/kumiko-guards@0.314.0
  - @cosmicdrift/kumiko-dev-server@0.314.0
  - @cosmicdrift/kumiko-repo-manifest@0.314.0

## 0.313.0

### Patch Changes

- Updated dependencies [773c52f]
- Updated dependencies [a14fd1f]
- Updated dependencies [4aa0c98]
- Updated dependencies [42c5298]
- Updated dependencies [16c81b9]
- Updated dependencies [f0c1ef1]
- Updated dependencies [93d7b77]
- Updated dependencies [4dea3ec]
- Updated dependencies [09a9148]
- Updated dependencies [b99240c]
- Updated dependencies [e7dc624]
  - @cosmicdrift/kumiko-bundled-features@0.313.0
  - @cosmicdrift/kumiko-framework@0.313.0
  - @cosmicdrift/kumiko-dev-server@0.313.0
  - @cosmicdrift/kumiko-testing@0.313.0
  - @cosmicdrift/kumiko-guards@0.313.0
  - @cosmicdrift/kumiko-repo-manifest@0.313.0

## 0.312.0

### Patch Changes

- Updated dependencies [f662b79]
- Updated dependencies [b2d00cf]
- Updated dependencies [1799c20]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
- Updated dependencies [f662b79]
  - @cosmicdrift/kumiko-bundled-features@0.312.0
  - @cosmicdrift/kumiko-framework@0.312.0
  - @cosmicdrift/kumiko-dev-server@0.312.0
  - @cosmicdrift/kumiko-testing@0.312.0
  - @cosmicdrift/kumiko-guards@0.312.0
  - @cosmicdrift/kumiko-repo-manifest@0.312.0

## 0.311.0

### Patch Changes

- Updated dependencies [348d60f]
- Updated dependencies [c448d50]
  - @cosmicdrift/kumiko-guards@0.311.0
  - @cosmicdrift/kumiko-testing@0.311.0
  - @cosmicdrift/kumiko-framework@0.311.0
  - @cosmicdrift/kumiko-bundled-features@0.311.0
  - @cosmicdrift/kumiko-dev-server@0.311.0
  - @cosmicdrift/kumiko-repo-manifest@0.311.0

## 0.310.0

### Patch Changes

- Updated dependencies [a2c9e30]
- Updated dependencies [4f36c3f]
- Updated dependencies [70fd8d6]
- Updated dependencies [da6c84f]
- Updated dependencies [ff05fae]
- Updated dependencies [9f16c3f]
  - @cosmicdrift/kumiko-bundled-features@0.310.0
  - @cosmicdrift/kumiko-framework@0.310.0
  - @cosmicdrift/kumiko-testing@0.310.0
  - @cosmicdrift/kumiko-dev-server@0.310.0
  - @cosmicdrift/kumiko-guards@0.310.0
  - @cosmicdrift/kumiko-repo-manifest@0.310.0

## 0.309.0

### Patch Changes

- Updated dependencies [75925be]
- Updated dependencies [cb0adcf]
- Updated dependencies [11b6f67]
- Updated dependencies [ac9bdae]
- Updated dependencies [a81c5d0]
- Updated dependencies [8f109b5]
- Updated dependencies [621c4de]
- Updated dependencies [711de11]
- Updated dependencies [621c4de]
- Updated dependencies [95a595d]
- Updated dependencies [837b712]
- Updated dependencies [711de11]
  - @cosmicdrift/kumiko-framework@0.309.0
  - @cosmicdrift/kumiko-bundled-features@0.309.0
  - @cosmicdrift/kumiko-dev-server@0.309.0
  - @cosmicdrift/kumiko-testing@0.309.0
  - @cosmicdrift/kumiko-guards@0.309.0
  - @cosmicdrift/kumiko-repo-manifest@0.309.0

## 0.308.0

### Patch Changes

- Updated dependencies [1b64375]
- Updated dependencies [1b64375]
- Updated dependencies [765f01b]
- Updated dependencies [49e07f5]
- Updated dependencies [ad701ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [6e5ed00]
- Updated dependencies [3ae4b82]
- Updated dependencies [9816d20]
- Updated dependencies [6b8b0ed]
- Updated dependencies [6e5ed00]
- Updated dependencies [685ecc9]
  - @cosmicdrift/kumiko-dev-server@0.308.0
  - @cosmicdrift/kumiko-testing@0.308.0
  - @cosmicdrift/kumiko-framework@0.308.0
  - @cosmicdrift/kumiko-guards@0.308.0
  - @cosmicdrift/kumiko-bundled-features@0.308.0
  - @cosmicdrift/kumiko-repo-manifest@0.308.0

## 0.307.0

### Patch Changes

- Updated dependencies [cc23d3d]
- Updated dependencies [0ce171d]
- Updated dependencies [a3f00b0]
- Updated dependencies [c5c5ddb]
- Updated dependencies [e682776]
- Updated dependencies [cc23d3d]
- Updated dependencies [4179f26]
- Updated dependencies [bc6fd32]
- Updated dependencies [aae3f5d]
  - @cosmicdrift/kumiko-bundled-features@0.307.0
  - @cosmicdrift/kumiko-dev-server@0.307.0
  - @cosmicdrift/kumiko-framework@0.307.0
  - @cosmicdrift/kumiko-testing@0.307.0
  - @cosmicdrift/kumiko-guards@0.307.0
  - @cosmicdrift/kumiko-repo-manifest@0.307.0

## 0.306.0

### Patch Changes

- Updated dependencies [b43fe63]
- Updated dependencies [8b4d672]
- Updated dependencies [fdf9377]
- Updated dependencies [499b9c2]
- Updated dependencies [4f96ced]
- Updated dependencies [2e332a3]
- Updated dependencies [5785f57]
- Updated dependencies [cb31fad]
- Updated dependencies [b43fe63]
- Updated dependencies [cbbbb19]
- Updated dependencies [946f7e7]
- Updated dependencies [c6013bd]
- Updated dependencies [b43fe63]
- Updated dependencies [659c575]
- Updated dependencies [946f7e7]
- Updated dependencies [0d5eef7]
- Updated dependencies [0d5eef7]
- Updated dependencies [7d17b0e]
  - @cosmicdrift/kumiko-bundled-features@0.306.0
  - @cosmicdrift/kumiko-framework@0.306.0
  - @cosmicdrift/kumiko-testing@0.306.0
  - @cosmicdrift/kumiko-dev-server@0.306.0
  - @cosmicdrift/kumiko-guards@0.306.0
  - @cosmicdrift/kumiko-repo-manifest@0.306.0

## 0.305.0

### Patch Changes

- Updated dependencies [90c5398]
- Updated dependencies [9de2cde]
- Updated dependencies [c41c201]
- Updated dependencies [05b87d7]
- Updated dependencies [0ee6000]
- Updated dependencies [0567906]
- Updated dependencies [d98d172]
- Updated dependencies [d42d76a]
  - @cosmicdrift/kumiko-framework@0.305.0
  - @cosmicdrift/kumiko-bundled-features@0.305.0
  - @cosmicdrift/kumiko-dev-server@0.305.0
  - @cosmicdrift/kumiko-testing@0.305.0
  - @cosmicdrift/kumiko-guards@0.305.0
  - @cosmicdrift/kumiko-repo-manifest@0.305.0

## 0.304.0

### Patch Changes

- Updated dependencies [e19227b]
  - @cosmicdrift/kumiko-testing@0.304.0
  - @cosmicdrift/kumiko-framework@0.304.0
  - @cosmicdrift/kumiko-bundled-features@0.304.0
  - @cosmicdrift/kumiko-dev-server@0.304.0
  - @cosmicdrift/kumiko-guards@0.304.0
  - @cosmicdrift/kumiko-repo-manifest@0.304.0

## 0.303.0

### Patch Changes

- Updated dependencies [3d28528]
  - @cosmicdrift/kumiko-framework@0.303.0
  - @cosmicdrift/kumiko-bundled-features@0.303.0
  - @cosmicdrift/kumiko-dev-server@0.303.0
  - @cosmicdrift/kumiko-testing@0.303.0
  - @cosmicdrift/kumiko-guards@0.303.0
  - @cosmicdrift/kumiko-repo-manifest@0.303.0

## 0.302.0

### Patch Changes

- Updated dependencies [deede20]
  - @cosmicdrift/kumiko-framework@0.302.0
  - @cosmicdrift/kumiko-bundled-features@0.302.0
  - @cosmicdrift/kumiko-dev-server@0.302.0
  - @cosmicdrift/kumiko-testing@0.302.0
  - @cosmicdrift/kumiko-guards@0.302.0
  - @cosmicdrift/kumiko-repo-manifest@0.302.0

## 0.301.0

### Patch Changes

- Updated dependencies [cf629d8]
- Updated dependencies [5028a6c]
- Updated dependencies [bae6958]
- Updated dependencies [5028a6c]
- Updated dependencies [5028a6c]
  - @cosmicdrift/kumiko-bundled-features@0.301.0
  - @cosmicdrift/kumiko-dev-server@0.301.0
  - @cosmicdrift/kumiko-framework@0.301.0
  - @cosmicdrift/kumiko-guards@0.301.0
  - @cosmicdrift/kumiko-testing@0.301.0
  - @cosmicdrift/kumiko-repo-manifest@0.301.0

## 0.300.0

### Patch Changes

- Updated dependencies [2414932]
- Updated dependencies [2414932]
  - @cosmicdrift/kumiko-bundled-features@0.300.0
  - @cosmicdrift/kumiko-framework@0.300.0
  - @cosmicdrift/kumiko-dev-server@0.300.0
  - @cosmicdrift/kumiko-testing@0.300.0
  - @cosmicdrift/kumiko-guards@0.300.0
  - @cosmicdrift/kumiko-repo-manifest@0.300.0

## 0.299.0

### Patch Changes

- Updated dependencies [b24647f]
- Updated dependencies [a9b29a8]
- Updated dependencies [aa09d45]
  - @cosmicdrift/kumiko-guards@0.299.0
  - @cosmicdrift/kumiko-dev-server@0.299.0
  - @cosmicdrift/kumiko-testing@0.299.0
  - @cosmicdrift/kumiko-framework@0.299.0
  - @cosmicdrift/kumiko-bundled-features@0.299.0
  - @cosmicdrift/kumiko-repo-manifest@0.299.0

## 0.298.0

### Patch Changes

- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [4ae8163]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
- Updated dependencies [6735981]
  - @cosmicdrift/kumiko-bundled-features@0.298.0
  - @cosmicdrift/kumiko-dev-server@0.298.0
  - @cosmicdrift/kumiko-framework@0.298.0
  - @cosmicdrift/kumiko-testing@0.298.0
  - @cosmicdrift/kumiko-guards@0.298.0
  - @cosmicdrift/kumiko-repo-manifest@0.298.0

## 0.297.0

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.297.0
- @cosmicdrift/kumiko-framework@0.297.0
- @cosmicdrift/kumiko-dev-server@0.297.0
- @cosmicdrift/kumiko-testing@0.297.0
- @cosmicdrift/kumiko-guards@0.297.0
- @cosmicdrift/kumiko-repo-manifest@0.297.0

## 0.296.0

### Patch Changes

- Updated dependencies [bfa7536]
- Updated dependencies [cb6e8a4]
- Updated dependencies [bfa7536]
- Updated dependencies [42b0562]
- Updated dependencies [f042685]
- Updated dependencies [d8cdd8a]
- Updated dependencies [3c34575]
  - @cosmicdrift/kumiko-bundled-features@0.296.0
  - @cosmicdrift/kumiko-framework@0.296.0
  - @cosmicdrift/kumiko-dev-server@0.296.0
  - @cosmicdrift/kumiko-testing@0.296.0
  - @cosmicdrift/kumiko-guards@0.296.0
  - @cosmicdrift/kumiko-repo-manifest@0.296.0

## 0.295.0

### Patch Changes

- Updated dependencies [294caec]
  - @cosmicdrift/kumiko-testing@0.295.0
  - @cosmicdrift/kumiko-framework@0.295.0
  - @cosmicdrift/kumiko-bundled-features@0.295.0
  - @cosmicdrift/kumiko-dev-server@0.295.0
  - @cosmicdrift/kumiko-guards@0.295.0
  - @cosmicdrift/kumiko-repo-manifest@0.295.0

## 0.294.1

### Patch Changes

- Updated dependencies [7f6fbc6]
  - @cosmicdrift/kumiko-framework@0.294.1
  - @cosmicdrift/kumiko-bundled-features@0.294.1
  - @cosmicdrift/kumiko-dev-server@0.294.1
  - @cosmicdrift/kumiko-guards@0.294.1
  - @cosmicdrift/kumiko-repo-manifest@0.294.1

## 0.294.0

### Patch Changes

- Updated dependencies [ea10c90]
  - @cosmicdrift/kumiko-framework@0.294.0
  - @cosmicdrift/kumiko-bundled-features@0.294.0
  - @cosmicdrift/kumiko-dev-server@0.294.0
  - @cosmicdrift/kumiko-guards@0.294.0
  - @cosmicdrift/kumiko-repo-manifest@0.294.0

## 0.293.0

### Patch Changes

- Updated dependencies [7fb8a62]
  - @cosmicdrift/kumiko-framework@0.293.0
  - @cosmicdrift/kumiko-bundled-features@0.293.0
  - @cosmicdrift/kumiko-dev-server@0.293.0
  - @cosmicdrift/kumiko-guards@0.293.0
  - @cosmicdrift/kumiko-repo-manifest@0.293.0

## 0.292.0

### Minor Changes

- 2f17bcb: New `kumiko check`: boot validation plus the guard suites in one command, step list derived from kumiko.json

  Until now every consumer repo assembled the same chain by hand — `kumiko-schema validate` plus `kumiko-guards guards|ui|checks` in package.json, CI YAML or check-wt.sh, in four different shapes, each with its own hand-written presence gate (`|| true`, `::error::`, `bun add --no-save`). `kumiko check` derives the step list declaratively from the kumiko.json manifest instead: `kind: "app"` adds boot validation (validateBoot over the composed FEATURES in kumiko/schema.ts), any kind other than "tooling" adds the AST guards and the repo checks, declared uiRoots add the UI guards, and a "tooling" repo says out loud that it has nothing to check. `--explain` prints the resolved step list with the reason for each step and passes through to the guards own --explain without running a suite. When @cosmicdrift/kumiko-guards cannot be loaded the command fails with an install hint instead of skipping silently.

  <!-- kumiko-changes
  feature: cli
  type: improvement
  title: New `kumiko check`: boot validation plus the guard suites in one command, step list derived from kumiko.json
  migration: |
    No action required — additive. A repo that today calls `kumiko-schema validate` and `kumiko-guards guards|ui|checks` separately in package.json, CI YAML or check-wt.sh replaces that chain with `bun kumiko check`; the step list then follows from kumiko.json (kind, uiRoots) instead of from the script. Private bins without a public counterpart (kumiko-guard-comment-lang, kumiko-guard-ui) stay as their own step next to it for now.
  -->

### Patch Changes

- Updated dependencies [787c572]
- Updated dependencies [fbe8ffa]
- Updated dependencies [7b5ac24]
- Updated dependencies [2f17bcb]
- Updated dependencies [6d53c10]
  - @cosmicdrift/kumiko-bundled-features@0.292.0
  - @cosmicdrift/kumiko-framework@0.292.0
  - @cosmicdrift/kumiko-dev-server@0.292.0
  - @cosmicdrift/kumiko-guards@0.292.0
  - @cosmicdrift/kumiko-repo-manifest@0.292.0

## 0.291.0

### Patch Changes

- Updated dependencies [1ae48cb]
- Updated dependencies [0fa2da2]
- Updated dependencies [c061ac9]
- Updated dependencies [ef54b65]
- Updated dependencies [d47adef]
- Updated dependencies [ca8d3e3]
- Updated dependencies [53e20f4]
- Updated dependencies [67a4227]
- Updated dependencies [0621367]
- Updated dependencies [0fd6bb5]
- Updated dependencies [9331ec5]
- Updated dependencies [229298b]
- Updated dependencies [32a1ce3]
  - @cosmicdrift/kumiko-bundled-features@0.291.0
  - @cosmicdrift/kumiko-framework@0.291.0
  - @cosmicdrift/kumiko-dev-server@0.291.0
  - @cosmicdrift/kumiko-repo-manifest@0.291.0

## 0.290.0

### Patch Changes

- Updated dependencies [878d8b2]
- Updated dependencies [9da6b5f]
- Updated dependencies [fe23245]
  - @cosmicdrift/kumiko-framework@0.290.0
  - @cosmicdrift/kumiko-bundled-features@0.290.0
  - @cosmicdrift/kumiko-dev-server@0.290.0
  - @cosmicdrift/kumiko-repo-manifest@0.290.0

## 0.289.0

### Patch Changes

- Updated dependencies [dea8ea0]
- Updated dependencies [a200a5c]
- Updated dependencies [78f9c42]
- Updated dependencies [efac5bb]
- Updated dependencies [20853fa]
- Updated dependencies [1e5a8e0]
- Updated dependencies [f01015e]
- Updated dependencies [a84d3cb]
- Updated dependencies [dea8ea0]
- Updated dependencies [2e868a7]
- Updated dependencies [253ade3]
- Updated dependencies [f01015e]
  - @cosmicdrift/kumiko-bundled-features@0.289.0
  - @cosmicdrift/kumiko-dev-server@0.289.0
  - @cosmicdrift/kumiko-framework@0.289.0
  - @cosmicdrift/kumiko-repo-manifest@0.289.0

## 0.288.0

### Patch Changes

- Updated dependencies [70cac5a]
  - @cosmicdrift/kumiko-bundled-features@0.288.0
  - @cosmicdrift/kumiko-dev-server@0.288.0
  - @cosmicdrift/kumiko-framework@0.288.0
  - @cosmicdrift/kumiko-repo-manifest@0.288.0

## 0.287.0

### Patch Changes

- Updated dependencies [7a60311]
- Updated dependencies [3489874]
- Updated dependencies [76f2631]
- Updated dependencies [89ba55f]
- Updated dependencies [89ba55f]
- Updated dependencies [3ce01df]
  - @cosmicdrift/kumiko-bundled-features@0.287.0
  - @cosmicdrift/kumiko-framework@0.287.0
  - @cosmicdrift/kumiko-dev-server@0.287.0
  - @cosmicdrift/kumiko-repo-manifest@0.287.0

## 0.286.0

### Patch Changes

- Updated dependencies [fb24ada]
- Updated dependencies [1f7ab5d]
  - @cosmicdrift/kumiko-bundled-features@0.286.0
  - @cosmicdrift/kumiko-framework@0.286.0
  - @cosmicdrift/kumiko-dev-server@0.286.0
  - @cosmicdrift/kumiko-repo-manifest@0.286.0

## 0.285.2

### Patch Changes

- Updated dependencies [9c28242]
  - @cosmicdrift/kumiko-framework@0.285.2
  - @cosmicdrift/kumiko-bundled-features@0.285.2
  - @cosmicdrift/kumiko-dev-server@0.285.2
  - @cosmicdrift/kumiko-repo-manifest@0.285.2

## 0.285.1

### Patch Changes

- @cosmicdrift/kumiko-framework@0.285.1
- @cosmicdrift/kumiko-bundled-features@0.285.1
- @cosmicdrift/kumiko-dev-server@0.285.1
- @cosmicdrift/kumiko-repo-manifest@0.285.1

## 0.285.0

### Patch Changes

- Updated dependencies [8ee38b3]
  - @cosmicdrift/kumiko-repo-manifest@0.285.0
  - @cosmicdrift/kumiko-framework@0.285.0
  - @cosmicdrift/kumiko-bundled-features@0.285.0
  - @cosmicdrift/kumiko-dev-server@0.285.0

## 0.284.0

### Patch Changes

- @cosmicdrift/kumiko-framework@0.284.0
- @cosmicdrift/kumiko-bundled-features@0.284.0
- @cosmicdrift/kumiko-dev-server@0.284.0
- @cosmicdrift/kumiko-repo-manifest@0.284.0

## 0.283.0

### Patch Changes

- Updated dependencies [45f7641]
  - @cosmicdrift/kumiko-framework@0.283.0
  - @cosmicdrift/kumiko-bundled-features@0.283.0
  - @cosmicdrift/kumiko-dev-server@0.283.0
  - @cosmicdrift/kumiko-repo-manifest@0.283.0

## 0.282.0

### Patch Changes

- Updated dependencies [a56b257]
  - @cosmicdrift/kumiko-bundled-features@0.282.0
  - @cosmicdrift/kumiko-dev-server@0.282.0
  - @cosmicdrift/kumiko-framework@0.282.0
  - @cosmicdrift/kumiko-repo-manifest@0.282.0

## 0.281.0

### Patch Changes

- Updated dependencies [8de23a7]
- Updated dependencies [7ae9256]
- Updated dependencies [7bf2e5e]
- Updated dependencies [f1dc700]
  - @cosmicdrift/kumiko-framework@0.281.0
  - @cosmicdrift/kumiko-bundled-features@0.281.0
  - @cosmicdrift/kumiko-dev-server@0.281.0
  - @cosmicdrift/kumiko-repo-manifest@0.281.0

## 0.4.10

### Patch Changes

- Updated dependencies [fae19a6]
  - @cosmicdrift/kumiko-framework@0.280.0
  - @cosmicdrift/kumiko-bundled-features@0.280.0
  - @cosmicdrift/kumiko-dev-server@0.280.0

## 0.4.9

### Patch Changes

- Updated dependencies [e55f357]
  - @cosmicdrift/kumiko-framework@0.279.0
  - @cosmicdrift/kumiko-bundled-features@0.279.0
  - @cosmicdrift/kumiko-dev-server@0.279.0

## 0.4.8

### Patch Changes

- Updated dependencies [17dcac1]
- Updated dependencies [17dcac1]
- Updated dependencies [3e1eb25]
- Updated dependencies [17dcac1]
- Updated dependencies [17dcac1]
  - @cosmicdrift/kumiko-bundled-features@0.278.0
  - @cosmicdrift/kumiko-framework@0.278.0
  - @cosmicdrift/kumiko-dev-server@0.278.0

## 0.4.7

### Patch Changes

- 1e185b5: Adds `@cosmicdrift/kumiko-guards`, a public single-repo port of the infra ts-morph security guards (`admin-api`, `direct-entity-writes`, `direct-fetch`, `escape-hatch-declared`, `no-direct-fs`, `open-to-all-reason`, `tenant-escalation`, `access-denied-test`) plus the shared guard-runner, scan-scope and per-repo security-baseline machinery. `@cosmicdrift/kumiko-repo-manifest` extracts the `kumiko.json` manifest schema and loader out of `@cosmicdrift/kumiko-cli` into its own package, since `kumiko-guards` needs it independently of the CLI. `@cosmicdrift/kumiko-cli` keeps its `./repo-manifest` subpath export unchanged, now re-exporting from the new package.
- Updated dependencies [411e80b]
- Updated dependencies [1e185b5]
  - @cosmicdrift/kumiko-framework@0.277.0
  - @cosmicdrift/kumiko-repo-manifest@0.1.0
  - @cosmicdrift/kumiko-bundled-features@0.277.0
  - @cosmicdrift/kumiko-dev-server@0.277.0

## 0.4.6

### Patch Changes

- Updated dependencies [e2312ee]
  - @cosmicdrift/kumiko-framework@0.276.0
  - @cosmicdrift/kumiko-bundled-features@0.276.0
  - @cosmicdrift/kumiko-dev-server@0.276.0

## 0.4.5

### Patch Changes

- Updated dependencies [2cb61dd]
- Updated dependencies [9d9a462]
  - @cosmicdrift/kumiko-framework@0.275.0
  - @cosmicdrift/kumiko-bundled-features@0.275.0
  - @cosmicdrift/kumiko-dev-server@0.275.0

## 0.4.4

### Patch Changes

- Updated dependencies [47070b6]
- Updated dependencies [282072a]
  - @cosmicdrift/kumiko-framework@0.274.0
  - @cosmicdrift/kumiko-bundled-features@0.274.0
  - @cosmicdrift/kumiko-dev-server@0.274.0

## 0.4.3

### Patch Changes

- Updated dependencies [e9d3944]
- Updated dependencies [01c9133]
  - @cosmicdrift/kumiko-framework@0.273.0
  - @cosmicdrift/kumiko-bundled-features@0.273.0
  - @cosmicdrift/kumiko-dev-server@0.273.0

## 0.4.2

### Patch Changes

- Updated dependencies [147fb82]
- Updated dependencies [6c55fa2]
- Updated dependencies [94812d3]
- Updated dependencies [7bf4309]
  - @cosmicdrift/kumiko-framework@0.272.0
  - @cosmicdrift/kumiko-bundled-features@0.272.0
  - @cosmicdrift/kumiko-dev-server@0.272.0

## 0.4.1

### Patch Changes

- Updated dependencies [94b9d44]
- Updated dependencies [c704c75]
- Updated dependencies [60ed7ed]
- Updated dependencies [c704c75]
- Updated dependencies [5f8be0d]
  - @cosmicdrift/kumiko-framework@0.271.0
  - @cosmicdrift/kumiko-bundled-features@0.271.0
  - @cosmicdrift/kumiko-dev-server@0.271.0

## 0.4.0

### Minor Changes

- 4a8dca4: Adds a `@cosmicdrift/kumiko-cli/repo-manifest` subpath exporting `repoManifestSchema`, `loadRepoManifest`, and `RepoManifestError` for reading a repo's `kumiko.json` layout manifest (fw#2856).

## 0.3.32

### Patch Changes

- Updated dependencies [dba0a60]
  - @cosmicdrift/kumiko-framework@0.270.0
  - @cosmicdrift/kumiko-bundled-features@0.270.0
  - @cosmicdrift/kumiko-dev-server@0.270.0

## 0.3.31

### Patch Changes

- Updated dependencies [3d58c23]
  - @cosmicdrift/kumiko-framework@0.269.2
  - @cosmicdrift/kumiko-bundled-features@0.269.2
  - @cosmicdrift/kumiko-dev-server@0.269.2

## 0.3.30

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.269.1
- @cosmicdrift/kumiko-dev-server@0.269.1
- @cosmicdrift/kumiko-framework@0.269.1

## 0.3.29

### Patch Changes

- Updated dependencies [ec9aaca]
- Updated dependencies [8412e09]
  - @cosmicdrift/kumiko-framework@0.269.0
  - @cosmicdrift/kumiko-bundled-features@0.269.0
  - @cosmicdrift/kumiko-dev-server@0.269.0

## 0.3.28

### Patch Changes

- Updated dependencies [b16457a]
  - @cosmicdrift/kumiko-framework@0.268.0
  - @cosmicdrift/kumiko-bundled-features@0.268.0
  - @cosmicdrift/kumiko-dev-server@0.268.0

## 0.3.27

### Patch Changes

- Updated dependencies [e87ab51]
  - @cosmicdrift/kumiko-framework@0.267.0
  - @cosmicdrift/kumiko-bundled-features@0.267.0
  - @cosmicdrift/kumiko-dev-server@0.267.0

## 0.3.26

### Patch Changes

- Updated dependencies [4d36b68]
  - @cosmicdrift/kumiko-framework@0.266.0
  - @cosmicdrift/kumiko-bundled-features@0.266.0
  - @cosmicdrift/kumiko-dev-server@0.266.0

## 0.3.25

### Patch Changes

- Updated dependencies [371a263]
  - @cosmicdrift/kumiko-framework@0.265.0
  - @cosmicdrift/kumiko-bundled-features@0.265.0
  - @cosmicdrift/kumiko-dev-server@0.265.0

## 0.3.24

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.264.1
- @cosmicdrift/kumiko-dev-server@0.264.1
- @cosmicdrift/kumiko-framework@0.264.1

## 0.3.23

### Patch Changes

- Updated dependencies [d0184f7]
  - @cosmicdrift/kumiko-framework@0.264.0
  - @cosmicdrift/kumiko-bundled-features@0.264.0
  - @cosmicdrift/kumiko-dev-server@0.264.0

## 0.3.22

### Patch Changes

- Updated dependencies [cd255ca]
- Updated dependencies [f6732fa]
  - @cosmicdrift/kumiko-framework@0.263.0
  - @cosmicdrift/kumiko-bundled-features@0.263.0
  - @cosmicdrift/kumiko-dev-server@0.263.0

## 0.3.21

### Patch Changes

- Updated dependencies [6fbede9]
  - @cosmicdrift/kumiko-framework@0.262.0
  - @cosmicdrift/kumiko-bundled-features@0.262.0
  - @cosmicdrift/kumiko-dev-server@0.262.0

## 0.3.20

### Patch Changes

- Updated dependencies [5139a3f]
  - @cosmicdrift/kumiko-framework@0.261.0
  - @cosmicdrift/kumiko-bundled-features@0.261.0
  - @cosmicdrift/kumiko-dev-server@0.261.0

## 0.3.19

### Patch Changes

- Updated dependencies [71b9c4b]
  - @cosmicdrift/kumiko-bundled-features@0.260.0
  - @cosmicdrift/kumiko-framework@0.260.0
  - @cosmicdrift/kumiko-dev-server@0.260.0

## 0.3.18

### Patch Changes

- Updated dependencies [20dc41a]
  - @cosmicdrift/kumiko-framework@0.259.0
  - @cosmicdrift/kumiko-bundled-features@0.259.0
  - @cosmicdrift/kumiko-dev-server@0.259.0

## 0.3.17

### Patch Changes

- Updated dependencies [b555e6c]
- Updated dependencies [3c6c428]
  - @cosmicdrift/kumiko-bundled-features@0.258.1
  - @cosmicdrift/kumiko-framework@0.258.1
  - @cosmicdrift/kumiko-dev-server@0.258.1

## 0.3.16

### Patch Changes

- Updated dependencies [f2e57b4]
- Updated dependencies [c1b53a3]
- Updated dependencies [27166cb]
  - @cosmicdrift/kumiko-framework@0.258.0
  - @cosmicdrift/kumiko-bundled-features@0.258.0
  - @cosmicdrift/kumiko-dev-server@0.258.0

## 0.3.15

### Patch Changes

- Updated dependencies [04794a7]
  - @cosmicdrift/kumiko-bundled-features@0.257.0
  - @cosmicdrift/kumiko-dev-server@0.257.0
  - @cosmicdrift/kumiko-framework@0.257.0

## 0.3.14

### Patch Changes

- Updated dependencies [586d707]
  - @cosmicdrift/kumiko-framework@0.256.0
  - @cosmicdrift/kumiko-bundled-features@0.256.0
  - @cosmicdrift/kumiko-dev-server@0.256.0

## 0.3.13

### Patch Changes

- Updated dependencies [2ec3f41]
  - @cosmicdrift/kumiko-bundled-features@0.255.2
  - @cosmicdrift/kumiko-dev-server@0.255.2
  - @cosmicdrift/kumiko-framework@0.255.2

## 0.3.12

### Patch Changes

- Updated dependencies [5b04527]
  - @cosmicdrift/kumiko-framework@0.255.1
  - @cosmicdrift/kumiko-bundled-features@0.255.1
  - @cosmicdrift/kumiko-dev-server@0.255.1

## 0.3.11

### Patch Changes

- Updated dependencies [88530a2]
- Updated dependencies [0374846]
- Updated dependencies [1212eeb]
- Updated dependencies [7003472]
  - @cosmicdrift/kumiko-framework@0.255.0
  - @cosmicdrift/kumiko-bundled-features@0.255.0
  - @cosmicdrift/kumiko-dev-server@0.255.0

## 0.3.10

### Patch Changes

- Updated dependencies [9b74bc9]
- Updated dependencies [a8f109b]
  - @cosmicdrift/kumiko-framework@0.254.0
  - @cosmicdrift/kumiko-bundled-features@0.254.0
  - @cosmicdrift/kumiko-dev-server@0.254.0

## 0.3.9

### Patch Changes

- Updated dependencies [e626ea3]
  - @cosmicdrift/kumiko-bundled-features@0.253.0
  - @cosmicdrift/kumiko-dev-server@0.253.0
  - @cosmicdrift/kumiko-framework@0.253.0

## 0.3.8

### Patch Changes

- @cosmicdrift/kumiko-bundled-features@0.252.1
- @cosmicdrift/kumiko-dev-server@0.252.1
- @cosmicdrift/kumiko-framework@0.252.1

## 0.3.7

### Patch Changes

- Updated dependencies [f0a494a]
  - @cosmicdrift/kumiko-bundled-features@0.252.0
  - @cosmicdrift/kumiko-dev-server@0.252.0
  - @cosmicdrift/kumiko-framework@0.252.0

## 0.3.6

### Patch Changes

- Updated dependencies [55691fd]
- Updated dependencies [28ad1f3]
  - @cosmicdrift/kumiko-framework@0.251.0
  - @cosmicdrift/kumiko-bundled-features@0.251.0
  - @cosmicdrift/kumiko-dev-server@0.251.0

## 0.3.5

### Patch Changes

- Updated dependencies [86e18dd]
- Updated dependencies [a4a25ee]
- Updated dependencies [e349f03]
- Updated dependencies [0be08d9]
- Updated dependencies [a8955dd]
- Updated dependencies [d9f9337]
- Updated dependencies [efe22b1]
- Updated dependencies [5c1c606]
  - @cosmicdrift/kumiko-framework@0.250.0
  - @cosmicdrift/kumiko-bundled-features@0.250.0
  - @cosmicdrift/kumiko-dev-server@0.250.0

## 0.3.4

### Patch Changes

- Updated dependencies [812795d]
- Updated dependencies [f268c17]
- Updated dependencies [14fb8a2]
  - @cosmicdrift/kumiko-framework@0.249.0
  - @cosmicdrift/kumiko-bundled-features@0.249.0
  - @cosmicdrift/kumiko-dev-server@0.249.0

## 0.3.3

### Patch Changes

- Updated dependencies [109ff0d]
  - @cosmicdrift/kumiko-framework@0.248.0
  - @cosmicdrift/kumiko-bundled-features@0.248.0
  - @cosmicdrift/kumiko-dev-server@0.248.0

## 0.3.2

### Patch Changes

- Updated dependencies [25cbdd2]
- Updated dependencies [f9f5608]
  - @cosmicdrift/kumiko-framework@0.247.0
  - @cosmicdrift/kumiko-bundled-features@0.247.0
  - @cosmicdrift/kumiko-dev-server@0.247.0

## 0.3.1

### Patch Changes

- Updated dependencies [b4d5b20]
- Updated dependencies [f2c9178]
- Updated dependencies [137191d]
  - @cosmicdrift/kumiko-framework@0.246.0
  - @cosmicdrift/kumiko-bundled-features@0.246.0
  - @cosmicdrift/kumiko-dev-server@0.246.0

## 0.3.0

### Minor Changes

- 63454f4: Ship the app-facing `agent`, `project` and `consumer` commands in the published `kumiko` binary. They previously existed only in the framework repo's private root package, so app repos installing `@cosmicdrift/kumiko-cli` got the scaffolding-only CLI under the same binary name (#2707).

  Also fixes `kumiko project list` and `kumiko project status` crashing on the projection timestamps — they are `Temporal.Instant`, which has no `toISOString()`.

### Patch Changes

- Updated dependencies [3359dae]
- Updated dependencies [d669ad6]
  - @cosmicdrift/kumiko-framework@0.245.0
  - @cosmicdrift/kumiko-bundled-features@0.245.0
  - @cosmicdrift/kumiko-dev-server@0.245.0

## 0.2.368

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.244.0

## 0.2.367

### Patch Changes

- Updated dependencies [8c7b961]
  - @cosmicdrift/kumiko-dev-server@0.243.4

## 0.2.366

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.3

## 0.2.365

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.2

## 0.2.364

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.1

## 0.2.363

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.243.0

## 0.2.362

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.242.0

## 0.2.361

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.241.0

## 0.2.360

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.240.0

## 0.2.359

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.239.0

## 0.2.358

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.238.0

## 0.2.357

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.237.2

## 0.2.356

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.237.1

## 0.2.355

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.237.0

## 0.2.354

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.236.1

## 0.2.353

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.236.0

## 0.2.352

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.235.4

## 0.2.351

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.235.3

## 0.2.350

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.235.2

## 0.2.349

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.235.1

## 0.2.348

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.235.0

## 0.2.347

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.234.0

## 0.2.346

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.233.0

## 0.2.345

### Patch Changes

- Updated dependencies [5dd1cc1]
  - @cosmicdrift/kumiko-dev-server@0.232.0

## 0.2.344

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.231.0

## 0.2.343

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.230.0

## 0.2.342

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.229.1

## 0.2.341

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.229.0

## 0.2.340

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.228.0

## 0.2.339

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.227.0

## 0.2.338

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.226.0

## 0.2.337

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.225.0

## 0.2.336

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.224.2

## 0.2.335

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.224.1

## 0.2.334

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.224.0

## 0.2.333

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.223.0

## 0.2.332

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.222.0

## 0.2.331

### Patch Changes

- Updated dependencies [1656ff9]
- Updated dependencies [1656ff9]
- Updated dependencies [fab31bf]
  - @cosmicdrift/kumiko-dev-server@0.221.0

## 0.2.330

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.220.1

## 0.2.329

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.220.0

## 0.2.328

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.219.0

## 0.2.327

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.218.0

## 0.2.326

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.217.0

## 0.2.325

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.216.0

## 0.2.324

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.7

## 0.2.323

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.6

## 0.2.322

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.5

## 0.2.321

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.4

## 0.2.320

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.3

## 0.2.319

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.2

## 0.2.318

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.215.1

## 0.2.317

### Patch Changes

- Updated dependencies [54fa88c]
- Updated dependencies [7a7f6a9]
  - @cosmicdrift/kumiko-dev-server@0.215.0

## 0.2.316

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.214.0

## 0.2.315

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.213.0

## 0.2.314

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.212.0

## 0.2.313

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.211.0

## 0.2.312

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.210.0

## 0.2.311

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.209.1

## 0.2.310

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.209.0

## 0.2.309

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.208.3

## 0.2.308

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.208.2

## 0.2.307

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.208.1

## 0.2.306

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.208.0

## 0.2.305

### Patch Changes

- Updated dependencies [dec6fd7]
  - @cosmicdrift/kumiko-dev-server@0.207.0

## 0.2.304

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.206.0

## 0.2.303

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.205.0

## 0.2.302

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.204.1

## 0.2.301

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.204.0

## 0.2.300

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.203.0

## 0.2.299

### Patch Changes

- Updated dependencies [e91d4cb]
  - @cosmicdrift/kumiko-dev-server@0.202.0

## 0.2.298

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.201.0

## 0.2.297

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.200.1

## 0.2.296

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.200.0

## 0.2.295

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.199.2

## 0.2.294

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.199.1

## 0.2.293

### Patch Changes

- Updated dependencies [df2db70]
  - @cosmicdrift/kumiko-dev-server@0.199.0

## 0.2.292

### Patch Changes

- Updated dependencies [80d03ba]
  - @cosmicdrift/kumiko-dev-server@0.198.0

## 0.2.291

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.197.1

## 0.2.290

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.197.0

## 0.2.289

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.196.1

## 0.2.288

### Patch Changes

- Updated dependencies [af7686d]
  - @cosmicdrift/kumiko-dev-server@0.196.0

## 0.2.287

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.195.0

## 0.2.286

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.194.0

## 0.2.285

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.193.1

## 0.2.284

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.193.0

## 0.2.283

### Patch Changes

- Updated dependencies [58505c6]
  - @cosmicdrift/kumiko-dev-server@0.192.0

## 0.2.282

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.191.0

## 0.2.281

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.190.0

## 0.2.280

### Patch Changes

- Updated dependencies [cac0d04]
  - @cosmicdrift/kumiko-dev-server@0.189.0

## 0.2.279

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.188.0

## 0.2.278

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.187.0

## 0.2.277

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.3

## 0.2.276

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.2

## 0.2.275

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.1

## 0.2.274

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.186.0

## 0.2.273

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.185.0

## 0.2.272

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.184.0

## 0.2.271

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.183.2

## 0.2.270

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.183.1

## 0.2.269

### Patch Changes

- Updated dependencies [4fecbb5]
  - @cosmicdrift/kumiko-dev-server@0.183.0

## 0.2.268

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.182.1

## 0.2.267

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.182.0

## 0.2.266

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.181.0

## 0.2.265

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.180.0

## 0.2.264

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.179.0

## 0.2.263

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.178.1

## 0.2.262

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.178.0

## 0.2.261

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.177.0

## 0.2.260

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.176.2

## 0.2.259

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.176.1

## 0.2.258

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.176.0

## 0.2.257

### Patch Changes

- Updated dependencies [bc1377e]
  - @cosmicdrift/kumiko-dev-server@0.175.0

## 0.2.256

### Patch Changes

- f5da76a: PR-review fix batch (careful-tier findings):

  - `stock-cap-guard`'s `checkStockCap` no longer lets a caller-supplied `where.tenantId` override the real tenant scope (spread order fix).
  - `defineCreateWithTenantDefaults` now validates `localeField` against the entity at define-time, matching the existing `currencyFields` check.
  - `resolveMfaTokenSecrets` treats an empty-string override the same as `undefined` — falls back to derivation instead of signing MFA tokens with an empty HMAC key.
  - `buildUpdateSchema` (schema-builder): a `""` submission for a `select` field with a default now maps to that default, not `null` — matches the insert path's "a field with a default is never unset" invariant, on both optional and required selects.
  - `kumiko upgrade`'s enterprise-package changelog discovery is detected by `changes.json` presence, not an `"ai-"` name-prefix heuristic that silently dropped differently-named or renamed packages.
  - **Deletion-request magic link** (`user-data-rights`): the verify token now goes in the URL fragment (`#token=`) instead of a query param, so it never lands in proxy/access logs — same convention as the export-download link.
  - `InfinityList` (renderer-web) discards a response whose request was superseded by a newer one (request-sequence guard) — a slow response for an old search term can no longer overwrite a faster response for a newer one.
  - `END_LABEL_MIN_ROWS` (renderer-web `DataTable`/`InfiniteSentinel`) aligned to the framework's default `pageSize` (50, was 20) so the "end of list" marker's default-case threshold matches reality; per-screen custom `pageSize` still isn't threaded down to this component (follow-up).

- Updated dependencies [50b7d0c]
  - @cosmicdrift/kumiko-dev-server@0.174.1

## 0.2.255

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.174.0

## 0.2.254

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.173.1

## 0.2.253

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.173.0

## 0.2.252

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.172.0

## 0.2.251

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.171.2

## 0.2.250

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.171.1

## 0.2.249

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.171.0

## 0.2.248

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.170.0

## 0.2.247

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.169.0

## 0.2.246

### Patch Changes

- Updated dependencies [fecbfe3]
  - @cosmicdrift/kumiko-dev-server@0.168.0

## 0.2.245

### Patch Changes

- Updated dependencies [49eb6df]
  - @cosmicdrift/kumiko-dev-server@0.167.1

## 0.2.244

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.167.0

## 0.2.243

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.166.0

## 0.2.242

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.165.4

## 0.2.241

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.165.3

## 0.2.240

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.165.2

## 0.2.239

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.165.1

## 0.2.238

### Patch Changes

- @cosmicdrift/kumiko-dev-server@2.0.0

## 0.2.237

### Patch Changes

- @cosmicdrift/kumiko-dev-server@1.0.0

## 0.2.236

### Patch Changes

- Updated dependencies [cf56745]
  - @cosmicdrift/kumiko-dev-server@0.165.0

## 0.2.235

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.164.0

## 0.2.234

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.163.3

## 0.2.233

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.163.2

## 0.2.232

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.163.1

## 0.2.231

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.163.0

## 0.2.230

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.162.0

## 0.2.229

### Patch Changes

- Updated dependencies [c7ac572]
- Updated dependencies [5eb3aa4]
  - @cosmicdrift/kumiko-dev-server@0.161.0

## 0.2.228

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.160.0

## 0.2.227

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.159.1

## 0.2.226

### Patch Changes

- @cosmicdrift/kumiko-dev-server@1.0.0

## 0.2.225

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.158.2

## 0.2.224

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.158.1

## 0.2.223

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.158.0

## 0.2.222

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.3

## 0.2.221

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.2

## 0.2.220

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.1

## 0.2.219

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.157.0

## 0.2.218

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.156.3

## 0.2.217

### Patch Changes

- Updated dependencies [f0a76da]
  - @cosmicdrift/kumiko-dev-server@0.156.2

## 0.2.216

### Patch Changes

- Updated dependencies [9ec4841]
  - @cosmicdrift/kumiko-dev-server@0.156.1

## 0.2.215

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.156.0

## 0.2.214

### Patch Changes

- Updated dependencies [36e30da]
  - @cosmicdrift/kumiko-dev-server@0.155.1

## 0.2.213

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.155.0

## 0.2.212

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.154.2

## 0.2.211

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.154.1

## 0.2.210

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.154.0

## 0.2.209

### Patch Changes

- Updated dependencies [caed246]
  - @cosmicdrift/kumiko-dev-server@0.153.0

## 0.2.208

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.152.0

## 0.2.207

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.151.1

## 0.2.206

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.151.0

## 0.2.205

### Patch Changes

- Updated dependencies [0e4cec9]
  - @cosmicdrift/kumiko-dev-server@0.150.0

## 0.2.204

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.149.2

## 0.2.203

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.149.1

## 0.2.202

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.149.0

## 0.2.201

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.148.0

## 0.2.200

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.147.3

## 0.2.199

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.147.2

## 0.2.198

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.147.1

## 0.2.197

### Patch Changes

- Updated dependencies [bdc5e27]
  - @cosmicdrift/kumiko-dev-server@0.147.0

## 0.2.196

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.4

## 0.2.195

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.3

## 0.2.194

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.2

## 0.2.193

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.1

## 0.2.192

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.146.0

## 0.2.191

### Patch Changes

- Updated dependencies [8367193]
  - @cosmicdrift/kumiko-dev-server@0.145.1

## 0.2.190

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.145.0

## 0.2.189

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.144.0

## 0.2.188

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.143.1

## 0.2.187

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.143.0

## 0.2.186

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.142.0

## 0.2.185

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.141.0

## 0.2.184

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.140.0

## 0.2.183

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.139.0

## 0.2.182

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.138.0

## 0.2.181

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.137.0

## 0.2.180

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.136.1

## 0.2.179

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.136.0

## 0.2.178

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.135.0

## 0.2.177

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.134.0

## 0.2.176

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.133.0

## 0.2.175

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.132.0

## 0.2.174

### Patch Changes

- Updated dependencies [ce77f02]
  - @cosmicdrift/kumiko-dev-server@0.131.0

## 0.2.173

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.130.2

## 0.2.172

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.130.1

## 0.2.171

### Patch Changes

- Updated dependencies [bb715dd]
  - @cosmicdrift/kumiko-dev-server@0.130.0

## 0.2.170

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.129.0

## 0.2.169

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.128.0

## 0.2.168

### Patch Changes

- Updated dependencies [f5d37a1]
  - @cosmicdrift/kumiko-dev-server@0.127.0

## 0.2.167

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.126.0

## 0.2.166

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.125.2

## 0.2.165

### Patch Changes

- Updated dependencies [8b21e66]
  - @cosmicdrift/kumiko-dev-server@0.125.1

## 0.2.164

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.125.0

## 0.2.163

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.124.0

## 0.2.162

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.3

## 0.2.161

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.2

## 0.2.160

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.123.1

## 0.2.159

### Patch Changes

- Updated dependencies [b0e70a7]
  - @cosmicdrift/kumiko-dev-server@0.123.0

## 0.2.158

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.5

## 0.2.157

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.4

## 0.2.156

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.3

## 0.2.155

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.2

## 0.2.154

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.1

## 0.2.153

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.122.0

## 0.2.152

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.121.1

## 0.2.151

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.121.0

## 0.2.150

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.120.0

## 0.2.149

### Patch Changes

- Updated dependencies [b01a4d2]
- Updated dependencies [6ffb71e]
  - @cosmicdrift/kumiko-dev-server@0.119.0

## 0.2.148

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.118.0

## 0.2.147

### Patch Changes

- Updated dependencies [e5bae38]
  - @cosmicdrift/kumiko-dev-server@0.117.0

## 0.2.146

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.116.1

## 0.2.145

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.116.0

## 0.2.144

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.115.1

## 0.2.143

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.115.0

## 0.2.142

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.114.0

## 0.2.141

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.113.1

## 0.2.140

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.113.0

## 0.2.139

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.112.1

## 0.2.138

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.112.0

## 0.2.137

### Patch Changes

- Updated dependencies [340acef]
  - @cosmicdrift/kumiko-dev-server@0.111.0

## 0.2.136

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.110.0

## 0.2.135

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.109.0

## 0.2.134

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.108.0

## 0.2.133

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.107.0

## 0.2.132

### Patch Changes

- Updated dependencies [d6fbd00]
  - @cosmicdrift/kumiko-dev-server@0.106.0

## 0.2.131

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.105.2

## 0.2.130

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.105.1

## 0.2.129

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.105.0

## 0.2.128

### Patch Changes

- Updated dependencies [a3c973e]
  - @cosmicdrift/kumiko-dev-server@0.104.0

## 0.2.127

### Patch Changes

- Updated dependencies [961d0bb]
  - @cosmicdrift/kumiko-dev-server@0.103.0

## 0.2.126

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.102.2

## 0.2.125

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.102.1

## 0.2.124

### Patch Changes

- Updated dependencies [0b90d0a]
  - @cosmicdrift/kumiko-dev-server@0.102.0

## 0.2.123

### Patch Changes

- Updated dependencies [a32f591]
- Updated dependencies [ab82597]
- Updated dependencies [a9f5b75]
  - @cosmicdrift/kumiko-dev-server@0.101.0

## 0.2.122

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.100.0

## 0.2.121

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.99.0

## 0.2.120

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.98.0

## 0.2.119

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.97.1

## 0.2.118

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.97.0

## 0.2.117

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.96.0

## 0.2.116

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.95.0

## 0.2.115

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.94.0

## 0.2.114

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.93.0

## 0.2.113

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.92.0

## 0.2.112

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.91.0

## 0.2.111

### Patch Changes

- Updated dependencies [9a90672]
  - @cosmicdrift/kumiko-dev-server@0.90.3

## 0.2.110

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.90.2

## 0.2.109

### Patch Changes

- Updated dependencies [04ec020]
  - @cosmicdrift/kumiko-dev-server@0.90.1

## 0.2.108

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.90.0

## 0.2.107

### Patch Changes

- Updated dependencies [ca33c52]
  - @cosmicdrift/kumiko-dev-server@0.89.0

## 0.2.106

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.88.0

## 0.2.105

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.87.3

## 0.2.104

### Patch Changes

- Updated dependencies [b04ca86]
  - @cosmicdrift/kumiko-dev-server@0.87.2

## 0.2.103

### Patch Changes

- Updated dependencies [cb2abcd]
  - @cosmicdrift/kumiko-dev-server@0.87.1

## 0.2.102

### Patch Changes

- Updated dependencies [c0cbfb5]
  - @cosmicdrift/kumiko-dev-server@0.87.0

## 0.2.101

### Patch Changes

- Updated dependencies [e9feadd]
  - @cosmicdrift/kumiko-dev-server@0.86.0

## 0.2.100

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.85.0

## 0.2.99

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.84.0

## 0.2.98

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.83.0

## 0.2.97

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.82.0

## 0.2.96

### Patch Changes

- Updated dependencies [9a798c5]
  - @cosmicdrift/kumiko-dev-server@0.81.1

## 0.2.95

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.81.0

## 0.2.94

### Patch Changes

- Updated dependencies [7e7e078]
  - @cosmicdrift/kumiko-dev-server@0.80.0

## 0.2.93

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.79.3

## 0.2.92

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.79.2

## 0.2.91

### Patch Changes

- Updated dependencies [4feba2b]
  - @cosmicdrift/kumiko-dev-server@0.79.1

## 0.2.90

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.79.0

## 0.2.89

### Patch Changes

- Updated dependencies [7d27b06]
  - @cosmicdrift/kumiko-dev-server@0.78.0

## 0.2.88

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.77.1

## 0.2.87

### Patch Changes

- Updated dependencies [452656c]
  - @cosmicdrift/kumiko-dev-server@0.77.0

## 0.2.86

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.76.1

## 0.2.85

### Patch Changes

- Updated dependencies [e7c164d]
  - @cosmicdrift/kumiko-dev-server@0.76.0

## 0.2.84

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.75.0

## 0.2.83

### Patch Changes

- Updated dependencies [6775bf9]
  - @cosmicdrift/kumiko-dev-server@0.74.0

## 0.2.82

### Patch Changes

- Updated dependencies [4a39cec]
  - @cosmicdrift/kumiko-dev-server@0.73.0

## 0.2.81

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.72.0

## 0.2.80

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.71.0

## 0.2.79

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.70.0

## 0.2.78

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.69.0

## 0.2.77

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.68.0

## 0.2.76

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.67.1

## 0.2.75

### Patch Changes

- Updated dependencies [d732bde]
  - @cosmicdrift/kumiko-dev-server@0.67.0

## 0.2.74

### Patch Changes

- Updated dependencies [7eacfcb]
  - @cosmicdrift/kumiko-dev-server@0.66.0

## 0.2.73

### Patch Changes

- Updated dependencies [dcdfe3f]
  - @cosmicdrift/kumiko-dev-server@0.65.0

## 0.2.72

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.64.0

## 0.2.71

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.63.0

## 0.2.70

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.62.0

## 0.2.69

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.61.0

## 0.2.68

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.60.4

## 0.2.67

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.60.3

## 0.2.66

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.60.2

## 0.2.65

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.60.1

## 0.2.64

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.60.0

## 0.2.63

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.59.2

## 0.2.62

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.59.1

## 0.2.61

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.59.0

## 0.2.60

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.58.0

## 0.2.59

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.57.2

## 0.2.58

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.57.1

## 0.2.57

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.57.0

## 0.2.56

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.56.1

## 0.2.55

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.56.0

## 0.2.54

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.55.1

## 0.2.53

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.55.0

## 0.2.52

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.54.0

## 0.2.51

### Patch Changes

- Updated dependencies [effc862]
  - @cosmicdrift/kumiko-dev-server@0.53.0

## 0.2.50

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.52.0

## 0.2.49

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.51.0

## 0.2.48

### Patch Changes

- Updated dependencies [0d92100]
  - @cosmicdrift/kumiko-dev-server@0.50.0

## 0.2.47

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.49.0

## 0.2.46

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.48.1

## 0.2.45

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.48.0

## 0.2.44

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.47.0

## 0.2.43

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.46.0

## 0.2.42

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.45.1

## 0.2.41

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.45.0

## 0.2.40

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.44.0

## 0.2.39

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.43.0

## 0.2.38

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.42.0

## 0.2.37

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.41.1

## 0.2.36

### Patch Changes

- Updated dependencies [3f2d6ee]
  - @cosmicdrift/kumiko-dev-server@0.41.0

## 0.2.35

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.40.1

## 0.2.34

### Patch Changes

- Updated dependencies [64a51ac]
  - @cosmicdrift/kumiko-dev-server@0.40.0

## 0.2.33

### Patch Changes

- Updated dependencies [34cb1f7]
  - @cosmicdrift/kumiko-dev-server@0.39.0

## 0.2.32

### Patch Changes

- Updated dependencies [0f093f1]
- Updated dependencies [ffcce8a]
  - @cosmicdrift/kumiko-dev-server@0.38.0

## 0.2.31

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.37.0

## 0.2.30

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.36.0

## 0.2.29

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.35.0

## 0.2.28

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.34.2

## 0.2.27

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.34.1

## 0.2.26

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.34.0

## 0.2.25

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.33.0

## 0.2.24

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.32.1

## 0.2.23

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.32.0

## 0.2.22

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.31.1

## 0.2.21

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.31.0

## 0.2.20

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.30.0

## 0.2.19

### Patch Changes

- Updated dependencies [581b5e9]
  - @cosmicdrift/kumiko-dev-server@0.29.0

## 0.2.18

### Patch Changes

- Updated dependencies [743db9b]
  - @cosmicdrift/kumiko-dev-server@0.28.0

## 0.2.17

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.27.0

## 0.2.16

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.26.0

## 0.2.15

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.25.0

## 0.2.14

### Patch Changes

- Updated dependencies [35d5833]
- Updated dependencies [52cd396]
  - @cosmicdrift/kumiko-dev-server@0.24.1

## 0.2.13

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.24.0

## 0.2.12

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.23.1

## 0.2.11

### Patch Changes

- Updated dependencies [e27b7b7]
  - @cosmicdrift/kumiko-dev-server@0.23.0

## 0.2.10

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.22.0

## 0.2.9

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.21.1

## 0.2.8

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.21.0

## 0.2.7

### Patch Changes

- Updated dependencies [6777250]
  - @cosmicdrift/kumiko-dev-server@0.20.0

## 0.2.6

### Patch Changes

- Updated dependencies [a146fc4]
  - @cosmicdrift/kumiko-dev-server@0.19.1

## 0.2.5

### Patch Changes

- Updated dependencies [2c84510]
  - @cosmicdrift/kumiko-dev-server@0.19.0

## 0.2.4

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.18.0

## 0.2.3

### Patch Changes

- Updated dependencies [239e9dc]
  - @cosmicdrift/kumiko-dev-server@0.17.0

## 0.2.2

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.16.0

## 0.2.1

### Patch Changes

- @cosmicdrift/kumiko-dev-server@0.15.0

## 0.2.0

### Minor Changes

- b8e1d48: New package `@cosmicdrift/kumiko-cli` — provides `kumiko` bin for
  `bunx @cosmicdrift/kumiko-cli new app <name>` and `add feature <name>`.
  Fixes the walkthrough's broken `bunx @cosmicdrift/kumiko-framework`
  promise (bin-name ≠ pkg-name). Delegates to scaffoldApp +
  scaffoldAppFeature from `@cosmicdrift/kumiko-dev-server`.

### Patch Changes

- Updated dependencies [b8e1d48]
- Updated dependencies [ce23d48]
  - @cosmicdrift/kumiko-dev-server@0.14.0
