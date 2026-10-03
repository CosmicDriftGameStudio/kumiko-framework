type LocalizedString = { readonly en: string; readonly de: string };

export const WAITLIST_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:waitlist-list.title": { en: "Waitlist", de: "Warteliste" },
  "waitlist.nav.waitlist": { en: "Waitlist", de: "Warteliste" },
  "waitlist:entity:waitlistEntry:field:name": { en: "Name", de: "Name" },
  "waitlist:entity:waitlistEntry:field:email": { en: "Email", de: "E-Mail" },
  "waitlist:entity:waitlistEntry:field:company": { en: "Company", de: "Firma" },
  "waitlist:entity:waitlistEntry:field:portfolio": { en: "Portfolio", de: "Portfolio" },
  "waitlist:entity:waitlistEntry:field:message": { en: "Message", de: "Nachricht" },
  "waitlist:entity:waitlistEntry:field:locale": { en: "Locale", de: "Sprache" },
  "waitlist:entity:waitlistEntry:field:status": { en: "Status", de: "Status" },
  "waitlist:entity:waitlistEntry:field:submittedAt": { en: "Created", de: "Erstellt" },
  "waitlist:entity:waitlistEntry:field:status:option:pending": {
    en: "Pending",
    de: "Ausstehend",
  },
  "waitlist:entity:waitlistEntry:field:status:option:invited": {
    en: "Invited",
    de: "Eingeladen",
  },
  "waitlist:entity:waitlistEntry:field:status:option:rejected": {
    en: "Rejected",
    de: "Abgelehnt",
  },
  "waitlist.action.invite": { en: "Invite", de: "Einladen" },
  "waitlist.action.reInvite": { en: "Re-invite", de: "Erneut einladen" },
  "waitlist.action.reject": { en: "Reject", de: "Ablehnen" },
  "waitlist.action.reject.confirm": {
    en: "Reject this entry? The data stays stored.",
    de: "Eintrag ablehnen? Die Daten bleiben gespeichert.",
  },
};
