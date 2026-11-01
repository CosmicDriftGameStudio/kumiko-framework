import type * as z from "zod";
import type { HelpdeskSubmitSchema } from "../payloads.ts";
import type { HELPDESK_WEBSITE_KINDS, HelpdeskPhoneMode } from "../web/constants.ts";

export type HelpdeskWebsiteKind = (typeof HELPDESK_WEBSITE_KINDS)[number];

export type HelpdeskWebsiteFormOptions = {
  readonly phone: HelpdeskPhoneMode;
  readonly kinds: readonly HelpdeskWebsiteKind[];
};

// The client adds challenge and nonce itself and falls back to the page language for locale.
export type HelpdeskWebsiteSubmitFields = Omit<
  z.input<typeof HelpdeskSubmitSchema>,
  "challenge" | "nonce" | "locale"
> & { readonly locale?: z.input<typeof HelpdeskSubmitSchema>["locale"] };

export type HelpdeskWebsiteSubmitResult =
  | { readonly kind: "sent" }
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds?: number }
  | { readonly kind: "failed" };

export type HelpdeskWebsiteClient = {
  load(): Promise<HelpdeskWebsiteFormOptions>;
  submit(fields: HelpdeskWebsiteSubmitFields): Promise<HelpdeskWebsiteSubmitResult>;
};

// Registered by HELPDESK_CLIENT_SOURCE as window.KumikoHelpdesk.
export type HelpdeskWebsiteWindow = { readonly KumikoHelpdesk?: HelpdeskWebsiteClient };
