// No imports: web/ re-exports these, and template-meta.ts pulls in zod and the framework engine.
export const MAIL_TONES = ["accent", "info", "success", "warning", "danger", "neutral"] as const;
export type MailTone = (typeof MAIL_TONES)[number];
