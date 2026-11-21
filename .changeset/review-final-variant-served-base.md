---
"@cosmicdrift/kumiko-bundled-features": patch
---

Publishing a template variant takes its variables from the delivered base, not from the base's open draft.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: A published variant follows the delivered base's variables
detail: Publishing a variant synced its variable schema from the base as the tenant edits it, including an unpublished base draft, so the variant went live with variables the delivered base lacks. Publish now syncs from the delivered base (the tenant's active row, else the active system default). Saving a variant draft still follows the base draft; a variant that uses a placeholder only the base draft knows is refused at publish until the base is published.
-->
