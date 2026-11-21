---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-server-runtime": patch
"@cosmicdrift/kumiko-testing": patch
---

Review fixes for the upgrade CLI, deploy Dockerfiles, PDF rasterizing, the changes fold and the video runner.

<!-- kumiko-changes
feature: framework
type: fix
title: Upgrade CLI canary baseline, multi-arch Dockerfiles, changes fold
detail: `kumiko-upgrade` treats a canary release as already handled only when no marker exists and the baseline is the installed canary; an explicit `--from <canary>` or an unreadable marker keeps the codemods and manual steps of that release pending, and the invalid-version message names the prerelease format. The production Dockerfile install (scaffold template and `docker/Dockerfile`) runs with `--ignore-scripts` so a build on another CPU cannot leave host-architecture binaries in the image; apps that need a lifecycle script must run it in the runtime stage. The release train also moves the `next` dist-tag to the release when `next` still points at an older canary. `changes fold` formats `changes.json` in memory and writes only after every file formatted. The registered video e2e port of one consumer app moves to 4353 because a recipe already used the old one. The puppeteer service refuses to extract embedded images when a PDF lists more than 200 of them or more than 50 megapixels in total.
-->
