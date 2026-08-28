---
"@cosmicdrift/kumiko-framework": patch
---

Fix `piiCiphertextResponseGuard` skipping its ciphertext scan entirely when no subject KMS is configured. Legacy ciphertext rows can outlive a KMS that was later unconfigured (crash, misconfigured redeploy), so a raw DB read leaking to a public JSON response went undetected during that window. The scan now runs unconditionally (dev/test → loud 500, prod → redact + log), independent of KMS configuration.
