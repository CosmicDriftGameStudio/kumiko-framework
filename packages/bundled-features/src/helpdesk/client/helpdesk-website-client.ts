import { isOneOf, isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type * as z from "zod";
import type { HelpdeskSubmitSchema } from "../payloads.ts";
import {
  HELPDESK_PHONE_MODES,
  HELPDESK_WEBSITE_KINDS,
  type HelpdeskPhoneMode,
} from "../web/constants.ts";

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

export const HELPDESK_WEBSITE_SUBMIT_OUTCOME = {
  Sent: "sent",
  RateLimited: "rate-limited",
  Failed: "failed",
} as const;

export type HelpdeskWebsiteSubmitResult =
  | { readonly kind: typeof HELPDESK_WEBSITE_SUBMIT_OUTCOME.Sent }
  | {
      readonly kind: typeof HELPDESK_WEBSITE_SUBMIT_OUTCOME.RateLimited;
      readonly retryAfterSeconds?: number;
    }
  | { readonly kind: typeof HELPDESK_WEBSITE_SUBMIT_OUTCOME.Failed };

export type HelpdeskWebsiteSubmitOutcome = HelpdeskWebsiteSubmitResult["kind"];

export type HelpdeskWebsiteClient = {
  load(): Promise<HelpdeskWebsiteFormOptions>;
  // submit resolves to "failed" instead of rejecting.
  submit(fields: HelpdeskWebsiteSubmitFields): Promise<HelpdeskWebsiteSubmitResult>;
};

// Registered by HELPDESK_CLIENT_SOURCE as window.KumikoHelpdesk.
export type HelpdeskWebsiteWindow = { readonly KumikoHelpdesk?: HelpdeskWebsiteClient };

type RawHelpdeskClient = {
  load(): unknown;
  submit(fields: HelpdeskWebsiteSubmitFields): unknown;
};

function isRawHelpdeskClient(value: unknown): value is RawHelpdeskClient {
  return (
    typeof propertyOf(value, "load") === "function" &&
    typeof propertyOf(value, "submit") === "function"
  );
}

function isWebsiteKind(value: unknown): value is HelpdeskWebsiteKind {
  return isOneOf(HELPDESK_WEBSITE_KINDS, value);
}

// An unreadable answer hides the phone field and offers every website kind: the submit still
// works and the server rejects a phone value it does not allow.
function formOptionsOf(value: unknown): HelpdeskWebsiteFormOptions {
  const phoneCandidate = propertyOf(value, "phone");
  const phone: HelpdeskPhoneMode = isOneOf(HELPDESK_PHONE_MODES, phoneCandidate)
    ? phoneCandidate
    : "off";
  const kindsCandidate = propertyOf(value, "kinds");
  const announced = Array.isArray(kindsCandidate) ? kindsCandidate.filter(isWebsiteKind) : [];
  return { phone, kinds: announced.length > 0 ? announced : HELPDESK_WEBSITE_KINDS };
}

function submitResultOf(value: unknown): HelpdeskWebsiteSubmitResult {
  if (!isPlainObject(value)) return { kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.Failed };
  if (value["kind"] === HELPDESK_WEBSITE_SUBMIT_OUTCOME.Sent) {
    return { kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.Sent };
  }
  if (value["kind"] === HELPDESK_WEBSITE_SUBMIT_OUTCOME.RateLimited) {
    const seconds = value["retryAfterSeconds"];
    return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
      ? { kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.RateLimited, retryAfterSeconds: seconds }
      : { kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.RateLimited };
  }
  return { kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.Failed };
}

// The global comes from a script tag, so its shape and answers are checked here once and the
// page works with a typed client.
export function helpdeskWebsiteClient(
  scope: object = globalThis,
): HelpdeskWebsiteClient | undefined {
  const candidate = propertyOf(scope, "KumikoHelpdesk");
  if (!isRawHelpdeskClient(candidate)) return undefined;
  return {
    load: () =>
      Promise.resolve()
        .then(() => candidate.load())
        .then(formOptionsOf),
    submit: (fields) =>
      Promise.resolve()
        .then(() => candidate.submit(fields))
        .then(submitResultOf, () => ({ kind: HELPDESK_WEBSITE_SUBMIT_OUTCOME.Failed })),
  };
}
