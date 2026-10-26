---
"@cosmicdrift/kumiko-guards": patch
---

kumiko-guards declares @cosmicdrift/kumiko-types as a dependency. Its guards import kumiko-types at runtime, so an install without the framework next to it failed with "Cannot find module '@cosmicdrift/kumiko-types/handlers'".

<!-- kumiko-changes
feature: guards
type: fix
title: kumiko-guards declares its kumiko-types dependency
detail: error-reasons, app-dockerfile and check-subpath-exports import @cosmicdrift/kumiko-types at runtime, but the package listed only ts-morph and zod. Installs that get kumiko-types through the framework kept working; an install of kumiko-guards alone failed on that import. The framework stays an optional peer, so run the guards from a project that installs it. Apps that install the framework need no change.
-->
