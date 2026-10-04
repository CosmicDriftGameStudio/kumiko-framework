---
"@cosmicdrift/kumiko-renderer": minor
---

useQuery option `concurrency` caps parallel requests per query name

`useQuery(type, payload, { concurrency: n })` lets at most n `dispatcher.query` calls of that query name run at once. The pool lives in the DispatcherProvider and is shared by every hook with the same name; the rest wait in line with `loading` still true. A hook that unmounts, refetches or changes its payload while waiting leaves the line without holding a slot, and a finished or failed request hands its slot to the next waiter. Without the option nothing changes.

<!-- kumiko-changes
feature: renderer
type: improvement
title: useQuery accepts concurrency to cap parallel requests per query name through a pool in the DispatcherProvider
-->
