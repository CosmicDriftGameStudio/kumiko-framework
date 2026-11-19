---
"@cosmicdrift/kumiko-cli": patch
---

`kumiko --version` prints the installed package version.

<!-- kumiko-changes
feature: cli
type: fix
title: kumiko --version prints the real package version
detail: `kumiko --version` and the first line of `kumiko --help` read the version from the package's own package.json instead of the hard-coded 0.1.0.
-->
