---
"@cosmicdrift/kumiko-server-runtime": patch
---

`buildProdBundle`'s "kein `<x>`.html gefunden" error (thrown when a discovered `src/client-<suffix>.tsx` has no matching HTML template) now names the source file and explains that it was auto-discovered by the `src/client-<suffix>.tsx` filename convention, with a rename suggestion if that wasn't intended. Previously the error only suggested creating the missing HTML template, which is the wrong fix when the file was meant to be a plain module rather than a bundle entry.
