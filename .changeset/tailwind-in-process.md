---
"@cosmicdrift/kumiko-server-runtime": patch
---

The prod build runs Tailwind in-process (`@tailwindcss/node` and `@tailwindcss/oxide`, resolved from the `@tailwindcss/cli` package) instead of spawning the CLI. Options mirror the CLI, and a parity test pins byte-identical output.

<!-- kumiko-changes
feature: server-runtime
type: improvement
title: Prod build runs Tailwind in-process instead of spawning the CLI
-->
