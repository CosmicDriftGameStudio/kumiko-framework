---
"@cosmicdrift/kumiko-cli": patch
---

The handbook build writes a redirect page per chapter.

<!-- kumiko-changes
feature: cli
type: fix
title: Handbook chapter links resolve on static hosting
detail: `kumiko handbuch build` now writes `<id>/index.html` for each chapter, a small page that redirects to `../#<id>` in the single handbook page, so the `<publicPath>/<id>` links from handbook-knowledge resolve without a rewrite rule.
-->
