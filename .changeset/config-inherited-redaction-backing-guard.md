---
"@cosmicdrift/kumiko-framework": patch
---

config: enforce inheritedToTenant redaction and guard backing:"secrets"

Completes two provisioning fields that #370 declared but left inert:

- **inheritedToTenant:false now redacts.** A tenant-side viewer (any role other
  than SystemAdmin) no longer receives the inherited system-row value — nor the
  fact that it is set — through `config:query:cascade` or `config:query:values`.
  Redaction strips the system-row level (value AND hasValue), recomputes the
  cascade winner, and runs before encrypted-masking so a masked key cannot leak
  "is set". SystemAdmin still sees the value.

- **backing:"secrets" now fails boot instead of silently degrading.** A
  non-system scope is rejected permanently (secrets are flat per (tenant,key),
  no cascade); a system scope is rejected until the secrets read/write dispatch
  is wired (framework#333). Previously the value persisted as config-encrypted
  behind the declaration, losing envelope-encryption / rotation / audit.

Blast radius zero: no shipped config key declares either field today.
