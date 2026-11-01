---
"@cosmicdrift/kumiko-cli": patch
"create-kumiko-app": patch
---

`kumiko --help`, `kumiko <command> --help` and `create-kumiko-app --help` no longer load the dev-server scaffolding stack. They start in about 30 ms instead of about 0.7 s.

<!-- kumiko-changes
feature: cli
type: fix
title: Help output of kumiko and create-kumiko-app starts without loading the scaffolder
detail: Both CLIs imported the `@cosmicdrift/kumiko-dev-server` barrel at the top, so every call, including `--help`, loaded framework, server-runtime and renderer (about 0.7 s cold). `kumiko new app`, `kumiko add feature`, `kumiko ports` and the create-kumiko-app scaffold step now import those modules when they run. Measured on an idle machine: `kumiko --help` 0.67 s to 0.03 s, `kumiko check --help` 0.67 s to 0.03 s, `create-kumiko-app --help` 0.65 s to 0.02 s.
-->
