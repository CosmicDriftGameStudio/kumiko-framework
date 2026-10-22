// Mail execution logic — separated from feature.ts and tests-injectable.
// Production wiring (mail-foundation transport) is a follow-up; the
// default impl throws so a missing setMailRunner is loud, not silent.

import * as z from "zod";

export const mailSpecSchema = z.object({
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string(),
  body: z.string(),
  from: z.string().optional(),
});

export type MailSpec = z.infer<typeof mailSpecSchema>;

export type MailDispatchResult =
  | { readonly ok: true; readonly status: number }
  // smtpCode is the adapter's SMTP reply code; a 5xx is a permanent rejection and is not retried.
  | { readonly ok: false; readonly error: string; readonly smtpCode?: number };

let mailRunner: (spec: MailSpec) => Promise<MailDispatchResult> = async () => ({
  ok: false,
  error:
    "no mail-runner configured — call setMailRunner() with a mail-foundation transport adapter",
});

export function setMailRunner(fn: (spec: MailSpec) => Promise<MailDispatchResult>): void {
  mailRunner = fn;
}

// @wrapper-known entry-point
export async function performMailDispatch(spec: MailSpec): Promise<MailDispatchResult> {
  return mailRunner(spec);
}
