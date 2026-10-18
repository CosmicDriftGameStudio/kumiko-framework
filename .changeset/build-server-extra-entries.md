---
"@cosmicdrift/kumiko-dev-server": minor
---

`buildServerBundle` and `kumiko-build` can bundle extra server entry points

Scripts such as a remote probe next to `bin/main.ts` can now ship in the same `dist-server/` image. Pass `extraEntries: ["bin/remote-probe.ts"]` to `buildServerBundle`, or `--entry bin/remote-probe.ts` (repeatable) to `kumiko-build`. Each file is emitted as `dist-server/<basename>.js` and shares the framework chunks. A missing file, or a basename that collides with `server`, `kumiko`, `worker`, `bootstrap` or another extra entry, fails the build before `dist-server/` is touched. `kumiko-build` now rejects unknown options instead of ignoring them.

<!-- kumiko-changes
feature: dev-server
type: improvement
title: kumiko-build --entry and buildServerBundle extraEntries bundle additional server entry points as dist-server/<basename>.js
detail: Opt-in per file, not every bin/ helper module; the output shares the chunk files with server.js. Unknown kumiko-build options now fail the build.
-->
