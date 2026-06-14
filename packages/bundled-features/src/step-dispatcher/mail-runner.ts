// Mail execution logic — separated from feature.ts and tests-injectable.
// Production wiring (mail-foundation transport) is a follow-up; the
// default impl throws so a missing setMailRunner is loud, not silent.

import { z } from "zod";

export const mailSpecSchema = z.object({
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string(),
  body: z.string(),
  from: z.string().optional(),
});

export type MailSpec = z.infer<typeof mailSpecSchema>;

export type MailDispatchResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly error: string };

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
