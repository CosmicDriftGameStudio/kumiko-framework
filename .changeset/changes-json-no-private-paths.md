---
"@cosmicdrift/kumiko-framework": patch
---

Published changelog no longer names paths in private repositories

<!-- kumiko-changes
feature: framework
type: fix
title: changes.json no longer ships paths into private repositories
detail: Older changelog entries named file paths and a docs path of private repositories. They now name only the repository. The changelog guard rejects a `<private-repo>/<path>` reference or a github.com link into a private repository.
-->
