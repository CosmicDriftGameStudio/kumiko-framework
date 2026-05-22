---
"@cosmicdrift/kumiko-dev-server": minor
---

`scaffoldDeploy()` inspects the app source-tree and emits Dockerfile blocks conditionally (Sprint 9.6 follow-up).

**Why this exists:** Sprint 9.6's first Dockerfile.template hardcoded `COPY --from=build /app/seeds ./seeds` with a "comment out if you don't use it" note in the changeset. Apps without a `seeds/` directory (e.g. studio.kumiko.so) crashed in Docker-build with `failed to compute cache key: "/app/seeds": not found`. Root-cause was a framework issue (template too rigid), not a per-app symptom — the framework should detect what the app actually has.

**Detection:**

- `hasSeeds` — `exists(sourceDir/seeds)`. Drives the ES-Ops `COPY ./seeds` block in the runtime stage.
- `hasPrivateGhPackages` — scan `package.json` `dependencies` + `devDependencies` for any `@cosmicdriftgamestudio/*` entry. Drives the `ARG GITHUB_TOKEN` blocks (multi-stage with explicit re-declaration inside the build-stage) and the `ENV GITHUB_TOKEN=${GITHUB_TOKEN}` re-export before `yarn install --immutable`.

**Template syntax:** mustache-style block conditionals `{{#flag}}…{{/flag}}` (multi-line via `[\s\S]`, surrounding line stripped on falsy). Plain `{{key}}` placeholder substitution is unchanged.

**New API:**

- `ScaffoldDeployOptions.sourceDir?: string` — defaults to `destination`. Lets the caller scaffold into one dir while detecting optional surfaces in another (rare).
- `ScaffoldDeployResult.detected: { hasSeeds, hasPrivateGhPackages }` — surfaced so the CLI can report what was emitted.

**6 new tests:** seeds detection (with + without), GH-Packages detection (private + public-only + malformed package.json).

Sprint 9.6's "starting point not contract" disclaimer in the original changeset is now obsolete for these two surfaces — apps no longer need to manually comment out lines.
