---
"@cosmicdrift/kumiko-dev-server": patch
---

New apps are scaffolded with infra reusables v1.2.4, the first tag whose app-dockerfile guard accepts the BuildKit secret mount of the managed Dockerfile.

<!-- kumiko-changes
feature: dev-server
type: fix
title: New apps start on infra reusables v1.2.4
detail: kumiko-create wrote kumiko.deploy.infraRef reusables-v1.2.0. With the 0.392 Dockerfile template that tag runs the frozen app-dockerfile guard, which rejects the secret mount, so a fresh app failed its first CI run. Existing apps set infraRef to reusables-v1.2.4 and run kumiko sync-managed --write.
-->
