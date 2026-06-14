---
"@cosmicdrift/kumiko-framework": patch
---

config: dev-path ENV→app-override bridge + values.query shows inherited defaults

Closes the two config-provisioning leftovers:

- **runDevApp now wires the ENV→config-app-override bridge** (keys with `env:`
  get their env value as the app-override default), symmetric to runProdApp —
  previously only the prod path did. The envSource is injectable (default
  `process.env`); a caller-supplied configResolver still overrides the default.

- **config:query:values now resolves through the full cascade** (the same path
  as config:query:cascade), so the admin mask shows an inherited default (e.g.
  an ENV-bridged app-override) instead of falling back to keyDef.default and
  hiding it. This unifies the two read handlers so they can no longer diverge.

- **inheritedToTenant:false redaction now strips every inherited platform rung**
  (system-row, app-override, computed, default), not only system-row. Surfacing
  the app-override otherwise re-opened the leak the redaction closes: a
  tenant-side viewer would see the platform ENV value through the app-override
  rung. Blast-radius zero — no shipped config key declares inheritedToTenant:false.
