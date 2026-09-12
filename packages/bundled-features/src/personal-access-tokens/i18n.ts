import type { PatScopeConfig } from "./scopes";

type LocalizedString = { readonly en: string };

export const PAT_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:api-tokens.title": { en: "Personal Access Tokens" },
  "screen:api-token-create.title": { en: "Create a new token" },

  "pat.list.col.name": { en: "Name" },
  "pat.list.col.prefix": { en: "Token" },
  "pat.list.col.scopes": { en: "Scopes" },
  "pat.list.col.status": { en: "Status" },
  "pat.list.col.created": { en: "Created" },
  "pat.list.col.expires": { en: "Expires" },
  "pat.list.revoke": { en: "Revoke" },
  "pat.list.revoke.confirm": { en: "Revoke this token? Anything using it will stop working." },

  "pat.create.title": { en: "Create a new token" },
  "pat.create.submit": { en: "Create token" },
  "pat.create.reauth": { en: "Confirm your identity" },

  "pat.created.title": { en: "Token created" },
  "pat.created.token": { en: "Your new token" },
  "pat.created.hint": { en: "Copy this token now — for security it is shown only this once." },
  "pat.created.dismiss": { en: "Done" },

  // Field labels for the secretMint's synthesized pseudo-entity
  // (`__action-form__`, see action-form-shim.ts) — required by the i18n
  // boot-validator (requiredKeysFromScreen); the declarative renderer
  // resolves these through the schema payload, not a client component's t().
  "personal-access-tokens:entity:__action-form__:field:name": { en: "Name" },
  "personal-access-tokens:entity:__action-form__:field:scopes": { en: "Per-API access" },
  "personal-access-tokens:entity:__action-form__:field:expiresInDays": { en: "Expires in (days)" },
  "personal-access-tokens:entity:__action-form__:field:currentPassword": {
    en: "Password (to confirm)",
  },
  "personal-access-tokens:entity:__action-form__:field:mfaCode": { en: "2FA code (if enabled)" },
};

// Per-grant-option labels for the mint form's `scopes` multiSelect —
// "<domain> (read)" / "<domain> (read & write)", matching the wording the
// former custom screen showed. `def.label` is an app-authored raw display
// string (not itself an i18n key).
export function patScopeOptionTranslations(
  scopes: PatScopeConfig,
): Readonly<Record<string, LocalizedString>> {
  const out: Record<string, LocalizedString> = {};
  for (const [domain, def] of Object.entries(scopes)) {
    out[`personal-access-tokens:entity:__action-form__:field:scopes:option:${domain}:read`] = {
      en: `${def.label} (read)`,
    };
    if (def.write && def.write.length > 0) {
      out[`personal-access-tokens:entity:__action-form__:field:scopes:option:${domain}:write`] = {
        en: `${def.label} (read & write)`,
      };
    }
  }
  return out;
}
