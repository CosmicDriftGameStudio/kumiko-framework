---
"@cosmicdrift/kumiko-dev-server": patch
---

Generated `schemas.generated.ts` and `types.generated.d.ts` now import zod as a namespace (`import * as z from "zod"`), matching the framework's own convention. Regenerate with `kumiko build` to pick it up.

<!-- kumiko-changes
feature: dev-server
type: fix
title: Codegen emits namespace zod imports
-->
