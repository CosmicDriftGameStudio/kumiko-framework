---
"@cosmicdrift/kumiko-cli": minor
---

New command `kumiko handbuch build` generates the user manual as a static page from a JSON config

`kumiko handbuch build <config.json> [--root <dir>] [--out <dir>] [--shots <dir>] [--texts <dir>] [--web-shots <dir>] [--web-texts <dir>] [--web-repo <dir>] [--repo <dir>] [--locale <l>] [--no-large]`. Relative config paths resolve against `--root` (default: the working directory); the default output is `<root>/.handbuch/<config-name>`. Image conversion needs `sharp`, which is an optional peer dependency: without it the command prints an install hint and exits 1. The command also needs the app's `@cosmicdrift/kumiko-framework` and `@cosmicdrift/kumiko-headless` (optional peers, loaded only when `handbuch build` runs). Replaces the workspace handbuch builder script.

<!-- kumiko-changes
feature: cli
type: improvement
title: kumiko handbuch build generates the user manual from a JSON config
-->
