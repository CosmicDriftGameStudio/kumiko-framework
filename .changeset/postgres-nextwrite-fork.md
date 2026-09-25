---
"@cosmicdrift/kumiko-framework": patch
---

Pin postgres to a fork carrying the nextWrite null-socket fix (fw#3243)

<!-- kumiko-changes
feature: framework
type: fix
title: Pin postgres to a fork carrying the nextWrite null-socket fix (fw#3243)
detail: |
  The framework now depends on @bender0oo0/postgres@3.4.9-kumiko.1, an exact pin of
  postgres 3.4.9 plus a backport of porsager/postgres#1209. Without the backport, a
  closed connection can crash the whole process with an uncaughtException
  ("null is not an object (evaluating 'socket.write')") instead of rejecting the
  in-flight query with CONNECTION_CLOSED. Apps get the fix automatically with this
  framework bump, no app-side changes needed. The pin is temporary and tracked for
  removal in kumiko-framework#3248 once the fix lands upstream.
-->
