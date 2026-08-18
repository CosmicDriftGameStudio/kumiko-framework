type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const PAT_FEATURE_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:api-tokens.title": {
    de: "Personal Access Tokens",
    en: "Personal Access Tokens",
    es: "Tokens de acceso personal",
  },
};
