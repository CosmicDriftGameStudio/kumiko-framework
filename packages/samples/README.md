# @cosmicdrift/kumiko-samples

Source trees of the Kumiko sample recipes, sample apps and bundled features, shipped in the repository layout:

```
samples/recipes/**
samples/apps/**
packages/bundled-features/package.json
packages/bundled-features/src/**
```

This package contains plain sources only. It has no runtime API and no entry point; tests, build output and dotfiles are left out. Point tooling at the installed package directory (resolve `@cosmicdrift/kumiko-samples/package.json`), for example `buildFewShotCorpus({ repoRoot })` from `@cosmicdrift/kumiko-dev-server`, to get the same entry ids and source paths as in the monorepo.

License: BUSL-1.1
