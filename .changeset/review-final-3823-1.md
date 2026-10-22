---
"@cosmicdrift/kumiko-renderer": patch
---

A configEdit form with secret-backed fields no longer turns into an error banner when the viewer may not list secrets. On `access_denied` from `secrets:query:list` the secret fields are hidden and the config fields stay editable and saveable; other secrets failures still show the banner.

<!-- kumiko-changes
feature: renderer
type: fix
title: Provider forms stay usable without secrets access
detail: The merged provider form (config keys plus secrets) previously showed only an error banner if the viewer was denied the secrets list. Now the secret fields are left out and host, port, sender and provider choice can still be saved.
-->
