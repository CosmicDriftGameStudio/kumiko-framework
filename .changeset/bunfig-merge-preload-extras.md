---
"@cosmicdrift/kumiko-testing": patch
---

`kumiko-testing bunfig` no longer drops entries an app appended to its own preload/pathIgnorePatterns arrays on disk

<!-- kumiko-changes
feature: testing
type: fix
title: mergeBunfig keeps app-local array extras instead of overwriting them
detail: |
  mergeBunfig only checked whether a key such as `preload` existed on both
  sides of the merge, not whether its array value matched. Regenerating a
  bunfig therefore silently replaced an app's `[test].preload`,
  `pathIgnorePatterns` or `coveragePathIgnorePatterns` array with the
  generated one, dropping any entry the app had appended by hand (measured
  against publicstatus's real bunfig.toml, which carries exactly this case
  for env.preload.ts/codegen.preload.ts and says so in a comment).
  mergeBunfig now diffs the parsed array for each of these three keys and
  appends entries only present on disk after the generated ones, so
  `kumiko-testing bunfig` is safe to rerun on an app that extended one of
  them. A `./test-setup/dom.preload.ts` entry left over from before the
  DOM preload became a package export (see the DOM-preload-package
  changeset in this same release) is not carried forward as an extra,
  since keeping it would preload the same DOM setup twice.
  A package preload an app deliberately adds from another variant (say
  `preload/env` in its unit bunfig) is kept; an unrecognized or superseded
  package preload path is dropped instead of kept as an extra, so a rename
  inside the package doesn't leave both the old and new path preloaded. A
  preload written as a single string rather than an array is read the same
  as a one-item array.
  Two known limits: a comment attached to an extra in the source bunfig is
  not preserved, only the value; and the template can no longer remove a
  `pathIgnorePatterns`/`coveragePathIgnorePatterns` entry from a consumer,
  since either key has no equivalent to preload's exclusion list, so a
  pattern it stops emitting stays in every consumer's bunfig until removed
  by hand. Unlike an unknown key, which blocks the merge, a stale array
  entry is kept silently rather than failing loudly.
-->
