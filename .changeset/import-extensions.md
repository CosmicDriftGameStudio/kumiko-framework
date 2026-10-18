---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-guards": minor
---

Relative imports name the TypeScript source file

<!-- kumiko-changes
feature: framework
type: improvement
title: import-extensions codemod and tsconfig options for .ts import specifiers
detail: The import-extensions codemod rewrites relative import and export specifiers that end in .js or .jsx to the .ts or .tsx file next to the importer (import, export from, import type, import() and mock.module). It leaves a specifier alone and reports it when no such file exists. The framework repo itself now imports with .ts endings; its published dist is unchanged. tsc writes .js into the dist, and the .d.ts files keep .ts specifiers, which TypeScript resolves to the sibling .d.ts. The tsconfig that compiles the code needs allowImportingTsExtensions and rewriteRelativeImportExtensions (TypeScript 5.7 or newer), and a project that only type-checks code from another project reference needs rewriteRelativeImportExtensions false plus emitDeclarationOnly. Consumer code with .js endings keeps running; nothing is required.
migration: Add allowImportingTsExtensions and rewriteRelativeImportExtensions to compilerOptions, then run bun kumiko-upgrade --apply, or bun node_modules/@cosmicdrift/kumiko-framework/src/scripts/codemod/import-extensions.ts . --write.
codemod: scripts/codemod/import-extensions.ts
-->

<!-- kumiko-changes
feature: guards
type: improvement
title: import-extensions guard reports relative .js and .jsx specifiers
detail: The import-extensions guard fails on a relative specifier that ends in .js or .jsx in a .ts or .tsx file (import, export from, import type and import()). Declaration files and fixtures are skipped. The message points to the import-extensions codemod. There is no baseline.
-->
