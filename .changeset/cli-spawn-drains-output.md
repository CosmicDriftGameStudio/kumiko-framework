---
"@cosmicdrift/kumiko-framework": patch
---

The `kumiko` CLI waits for a child's output pipes to close before it reports the result, so under load a command no longer loses its output.

<!-- kumiko-changes
feature: framework
type: fix
title: kumiko CLI commands keep the whole output of the processes they start
detail: `run` and `runStreaming` in `bin/commands/_spawn.ts` settled on the child's `exit` event, which can fire before stdout and stderr are drained. Under load `kumiko status` then read an empty `git status` as a clean tree, and streamed commands such as `kumiko check` and `kumiko test` could drop their last lines. Both now settle on `close`; the timeout and SIGKILL handling is unchanged.
-->
