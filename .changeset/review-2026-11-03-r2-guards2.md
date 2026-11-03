---
"@cosmicdrift/kumiko-guards": patch
---

Guards: Dockerfile heredoc and `bun i` parsing, scoped registry token variables, CRLF/BOM doc frontmatter, symlink-safe doc walk, class accessors in agent docs, inverted flag conditions, accurate unused-exception warning, smaller pre-push pool floor, escape-aware literal prefilters, deterministic concurrency tests.

<!-- kumiko-changes
feature: framework
type: fix
title: Guards: parser and diagnostic fixes, escape-aware prefilters
detail: The app-dockerfile guard now sees RUN heredocs and the `bun i` alias, accepts an inline token assignment only when it reads the mounted secret, and takes token variables only from the private scope's registry entry. The doc-status guard tolerates CRLF and a BOM and skips symlinks while walking. Agent docs render public class accessors with their types and no longer derive a flag call from an `!== true` condition. The security check no longer calls an expired or shadowed repo exception unused. The pre-push pool floor drops from four lanes to two. The RLS-setting, test-ES-fixture and test-ES-row-write guards resolve string escapes (`_`, `\x20`) before matching and their text prefilters no longer skip files containing escapes. Two timing-based guard tests now synchronize instead of measuring wall-clock time.
-->
