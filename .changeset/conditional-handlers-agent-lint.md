---
"create-kumiko-app": patch
---

feature-manifest.json now lists the six auth-email-password write handlers that
only exist when `passwordReset` / `emailVerification` / `accountUnlock` are
configured — the use-all-bundled sample the manifest is introspected from mounts
those branches, so `kumiko agent lint` covers them too.
