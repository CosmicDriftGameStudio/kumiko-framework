---
"@cosmicdrift/kumiko-bundled-features": patch
---

copy-locale and export-bundle handle system sources and mixed formats

<!-- kumiko-changes
feature: template-resolver
type: fix
title: copy-locale ignores archived tenant sources and duplicates linked files of system sources; export-bundle refuses locales with differing format
detail: copy-locale no longer copies from an archived tenant template, and copying a system template duplicates its linked resource files into the target tenant. export-bundle rejects a bundle whose locales differ in content format or variable schema with `bundleLocalesDiffer`.
-->
