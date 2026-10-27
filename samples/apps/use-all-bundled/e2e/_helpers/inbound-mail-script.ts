import * as z from "zod";

export const INBOUND_MAIL_E2E_ROUTE = "/__e2e/inbound-mail-script";

export const inboundMailScriptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auth-failure-on-next-probe"), accountId: z.uuid() }),
  z.object({
    kind: z.literal("quarantine-unparseable-message"),
    accountId: z.uuid(),
    providerMessageId: z.string().min(1),
  }),
]);

export type InboundMailScript = z.infer<typeof inboundMailScriptSchema>;
