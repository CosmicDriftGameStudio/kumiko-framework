// @runtime client
import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";

export const defaultTranslations: TranslationsByLocale = {
  en: {
    "tenant.members.title": "Members",
    "tenant.members.loading": "Loading members…",
    "tenant.members.active": "Active members",
    "tenant.members.invite.title": "New invitation",
    "tenant.members.invite.email": "Email",
    "tenant.members.invite.role": "Role",
    "tenant.members.invite.submit": "Send invitation",
    "tenant.members.invite.submitting": "Sending invitation…",
    "tenant.members.invite.success": "Invitation sent to {email}",
    "tenant.members.pending": "Pending invitations",
    "tenant.members.pending.empty": "No pending invitations.",
    "tenant.members.cancel": "Cancel",
    "tenant.members.col.userId": "User ID",
    "tenant.members.col.roles": "Roles",
    "tenant.members.col.email": "Email",
    "tenant.members.col.expires": "Valid until",
    "tenant.nav.members": "Team",
  },
};
