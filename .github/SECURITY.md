# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Kumiko Framework, **please do not
open a public issue or discussion**. Instead, report it privately so we can
investigate and ship a fix before the issue becomes widely known.

**Preferred channels (in order):**

1. [GitHub Private Vulnerability Reporting](https://github.com/cosmicdriftgamestudio/kumiko-framework/security/advisories/new) —
   no email needed, fully tracked in GitHub Security tab.
2. Email **security@cosmicdriftgamestudio.com** with a description and reproduction steps.

You can expect:

- An initial acknowledgement within **3 working days**.
- A public advisory + patch release once a fix is available.
- Credit in the advisory unless you prefer to remain anonymous.

## Supported Versions

Only the latest minor version published on npm receives security fixes.
Older versions are not maintained.

## Scope

In scope:

- Code under `packages/framework`, `packages/bundled-features`,
  `packages/dev-server`, `packages/headless`, `packages/dispatcher-live`,
  `packages/renderer`, `packages/renderer-web`.
- Default-on security mechanisms (auth, tenant scoping, field-level access,
  secret encryption, audit trail).

Out of scope:

- Sample apps under `samples/` — illustrative, not production code.
- Issues that require a malicious app-author with code-execution rights
  (the framework trusts feature code by design).

## Coordinated Disclosure

We follow [coordinated disclosure](https://www.cisa.gov/coordinated-vulnerability-disclosure-process):
public details land in an advisory only after a patched release is available
on npm, with at minimum a 7-day grace period for downstream operators.
