---
"@cosmicdrift/kumiko-framework": patch
---

`parseFeatureFile` built a full TypeScript program (about 1000 workspace files) the first time it resolved an identifier or registrar wrapper imported from another file, costing 0.5–5 s per feature file. Cross-file names are now resolved syntactically via module resolution and export walking, without a type checker.

<!-- kumiko-changes
feature: framework
type: improvement
title: feature-ast resolves imported constants and registrar wrappers without building a TypeScript program
detail: |
  Imported `const` initializers (named imports, aliases, `export { X as Y }`,
  re-export chains, `export *`) and imported registrar-wrapper functions are
  resolved through `ts.resolveModuleName` plus a syntactic export walk.
  Same-file lookups walk enclosing block scopes instead of the file top level. Parse
  output is unchanged; parsing a feature file drops from hundreds of
  milliseconds to a few milliseconds.
-->
