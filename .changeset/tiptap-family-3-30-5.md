---
"@cosmicdrift/kumiko-renderer-web": patch
---

Raise the tiptap family floor to `^3.30.5` (`@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`).

`^3.29.2` allowed the fixed version but did not force it, so a lockfile resolved before the advisory stayed on the vulnerable 3.29.2. The tiptap packages are pinned exactly to each other and have to move together, which left consumers working around it with a large `overrides` block. Raising the floor here makes the old resolution impossible at the source.
