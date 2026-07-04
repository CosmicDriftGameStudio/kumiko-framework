---
"@cosmicdrift/kumiko-framework": patch
---

Expose the logging module as a package subpath:
`import { createLogger, type Logger } from "@cosmicdrift/kumiko-framework/logging"`.
Consumer apps no longer need `console.*` fallbacks with biome-ignore comments (fw#825).
