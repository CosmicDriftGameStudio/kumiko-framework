# account-security

Self-service dashboard for the signed-in user. It composes the screens of
[`auth-mfa`](../auth-mfa/) (enable MFA, regenerate recovery codes, disable MFA)
and [`sessions`](../sessions/) (own sessions with revoke) into one screen,
`account-security:screen:account-security`. The feature owns no handlers; the
embedded screens keep their own handler access.

## Setup

```typescript
import { createAccountSecurityFeature } from "@cosmicdrift/kumiko-bundled-features/account-security";
import { createAuthMfaFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";

const features = [
  createSessionsFeature(),
  createAuthMfaFeature({ /* secrets, issuer */ }),
  createAccountSecurityFeature(),
];
```

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `access` | `openToAll` | Who may open the dashboard, e.g. `{ roles: ["Admin", "Editor"] }` |
| `nav` | none | `{ order?, parent? }` adds a sidebar entry. Without it the screen is dormant and apps link it from the user menu |

The MFA panels switch on `auth-mfa:query:status` (`enabled`), exported as
`accountSecurityMfaStatusVisibility`.
