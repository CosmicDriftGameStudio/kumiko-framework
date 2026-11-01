// DOM-free waitlist sign-up for static sites: fetch plus pure logic only.

import {
  dispatchWrite,
  type StaticResult,
  staticSuccess,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";
import { WaitlistHandlers } from "./web/constants.ts";

export {
  STATIC_NETWORK_REASON,
  STATIC_RATE_LIMITED_REASON,
  type StaticFailure,
  type StaticResult,
  type StaticSuccess,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/static-client";

export type WaitlistSubmission = {
  readonly name: string;
  readonly email: string;
  readonly company?: string;
  readonly portfolio?: string;
  readonly message?: string;
  /** BCP 47 tag of the page language; also picks the language of the confirmation mail. */
  readonly locale: string;
  /** Honeypot: render it as a hidden field named `website` and pass its value through unchanged. */
  readonly website?: string;
};

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

/** Success reads the same for a new and an already listed address. */
export async function submitToWaitlist(
  submission: WaitlistSubmission,
): Promise<StaticResult<undefined>> {
  const { name, email, locale, website } = submission;
  const company = nonBlank(submission.company);
  const portfolio = nonBlank(submission.portfolio);
  const message = nonBlank(submission.message);
  const result = await dispatchWrite(
    WaitlistHandlers.submit,
    {
      name,
      email,
      locale,
      ...(company !== undefined && { company }),
      ...(portfolio !== undefined && { portfolio }),
      ...(message !== undefined && { message }),
      ...(website !== undefined && { website }),
    },
    { locale },
  );
  return result.kind === "success" ? staticSuccess(undefined) : result;
}
