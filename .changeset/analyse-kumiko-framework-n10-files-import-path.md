---
"@cosmicdrift/kumiko-bundled-features": minor
---

The `@cosmicdrift/kumiko-bundled-features/files` subpath is removed; import the files feature from `@cosmicdrift/kumiko-framework/files`.

<!-- kumiko-changes
feature: files
type: breaking
title: files feature only under @cosmicdrift/kumiko-framework/files
detail: `@cosmicdrift/kumiko-bundled-features/files` only re-exported `createFilesFeature` and `fileRefEntity` from the framework. The subpath is gone, so the feature has one import path. Behaviour of the feature is unchanged; create-kumiko-app and the dev-server scaffold now write the framework import.
migration: Replace `import { createFilesFeature, fileRefEntity } from "@cosmicdrift/kumiko-bundled-features/files"` with `import { createFilesFeature, fileRefEntity } from "@cosmicdrift/kumiko-framework/files"`.
affects: kumiko-bundled-features/files
-->
