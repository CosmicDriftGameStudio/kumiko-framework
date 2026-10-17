---
"@cosmicdrift/kumiko-cli": patch
---

handbuch build refuses to wipe the working directory or a source repo, and a too-old framework install is no longer reported as missing

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko handbuch build refuses a dangerous --out; missing-peer message tells an outdated install from a missing one
detail: handbuch build deletes the output directory before building, so `--out .` or `--out <root>` removed the checkout. The command now exits 2 when --out is, or contains, the working directory, --root or a configured source repo. When an installed @cosmicdrift package lacks a requested subpath, the error asks for an upgrade instead of recommending bun add.
-->
