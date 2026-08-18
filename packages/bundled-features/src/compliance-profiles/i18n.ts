type LocalizedString = { readonly de: string; readonly en: string; readonly es: string };

export const COMPLIANCE_PROFILES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:profile-picker.title": {
    de: "Compliance-Profil",
    en: "Compliance profile",
    es: "Perfil de cumplimiento",
  },
  "compliance-profiles:nav.profilePicker": {
    de: "Compliance",
    en: "Compliance",
    es: "Cumplimiento",
  },
};
