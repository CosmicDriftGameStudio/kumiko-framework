---
"@cosmicdrift/kumiko-dev-server": patch
"create-kumiko-app": patch
---

A freshly scaffolded app passes `bun run lint` without rework

<!-- kumiko-changes
feature: dev-server
type: fix
title: A freshly scaffolded app passes bun run lint without rework
detail: New projects now get a .gitignore, an exactly pinned @biomejs/biome and lint-clean generated files (import order, formatting). Existing apps are untouched.
-->
