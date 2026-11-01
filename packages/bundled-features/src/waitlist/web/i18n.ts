import {
  type TranslationsByLocale,
  translationsByLocaleFromKeys,
} from "@cosmicdrift/kumiko-renderer";

// German copy also ships in locale-de; this bundle keeps the public screen readable without it.
export const WAITLIST_PUBLIC_I18N = {
  "waitlist.public.title": { en: "Join the waitlist", de: "Auf die Warteliste" },
  "waitlist.public.intro": {
    en: "Leave your details and we will get in touch as soon as there is room.",
    de: "Hinterlasse deine Daten, wir melden uns, sobald Platz ist.",
  },
  "waitlist.public.name": { en: "Name", de: "Name" },
  "waitlist.public.email": { en: "Email", de: "E-Mail" },
  "waitlist.public.company": { en: "Company (optional)", de: "Firma (optional)" },
  "waitlist.public.message": { en: "Message (optional)", de: "Nachricht (optional)" },
  "waitlist.public.submit": { en: "Join the waitlist", de: "Auf die Warteliste setzen" },
  "waitlist.public.submitting": { en: "…", de: "…" },
  "waitlist.public.successTitle": { en: "You are on the list", de: "Du bist auf der Liste" },
  "waitlist.public.successBody": {
    en: "Thank you. We will write to you as soon as there is room.",
    de: "Danke. Wir schreiben dir, sobald Platz ist.",
  },
  "waitlist.public.error": {
    en: "That did not work. Please check your entries and try again.",
    de: "Das hat nicht geklappt. Bitte prüfe deine Angaben und versuche es erneut.",
  },
  "waitlist.public.haveAccount": {
    en: "Already have an account? Sign in",
    de: "Bereits ein Konto? Anmelden",
  },
} as const;

export const defaultTranslations: TranslationsByLocale =
  translationsByLocaleFromKeys(WAITLIST_PUBLIC_I18N);
