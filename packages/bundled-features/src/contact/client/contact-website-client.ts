import type * as z from "zod";
import type { ContactSubmitSchema } from "../payloads.ts";
import type { CONTACT_WEBSITE_KINDS, ContactPhoneMode } from "../web/constants.ts";

export type ContactWebsiteKind = (typeof CONTACT_WEBSITE_KINDS)[number];

export type ContactWebsiteFormOptions = {
  readonly phone: ContactPhoneMode;
  readonly kinds: readonly ContactWebsiteKind[];
};

// The client adds challenge and nonce itself and falls back to the page language for locale.
export type ContactWebsiteSubmitFields = Omit<
  z.input<typeof ContactSubmitSchema>,
  "challenge" | "nonce" | "locale"
> & { readonly locale?: z.input<typeof ContactSubmitSchema>["locale"] };

export type ContactWebsiteSubmitResult =
  | { readonly kind: "sent" }
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds?: number }
  | { readonly kind: "failed" };

export type ContactWebsiteClient = {
  load(): Promise<ContactWebsiteFormOptions>;
  submit(fields: ContactWebsiteSubmitFields): Promise<ContactWebsiteSubmitResult>;
};

// Registered by CONTACT_CLIENT_SOURCE as window.KumikoContact.
export type ContactWebsiteWindow = { readonly KumikoContact?: ContactWebsiteClient };
