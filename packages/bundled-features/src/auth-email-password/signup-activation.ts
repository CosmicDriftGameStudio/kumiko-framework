// Mints a signup activation link: invalidates any live token for the email,
// stores a fresh one and mails the activation link. Shared by the
// signup-request handler and by apps that issue the same link from their own
// flow (e.g. a waitlist invite), so TTL, store keys and notification type
// cannot drift between the two.

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
import type { NotifyFn } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Redis } from "ioredis";
import { AUTH_SIGNUP_DEFAULT_TTL_MINUTES } from "./constants.js";
import { renderActivationEmail } from "./email-templates.js";
import { dispatchMagicLinkMail } from "./magic-link-mail.js";
import {
  invalidateExistingSignupToken,
  normalizeEmail,
  storeSignupToken,
} from "./signup-token-store.js";

export const SIGNUP_ACTIVATION_NOTIFICATION_TYPE = "auth-email-password:signup-activation";

export type IssueSignupActivationArgs = {
  readonly redis: Redis;
  readonly notify: NotifyFn | undefined;
  readonly email: string;
  readonly appUrl: string | ((locale: string) => string);
  readonly appName?: string;
  readonly locale?: string;
  readonly timeZone?: string;
  readonly tokenTtlMinutes?: number;
  /** Runs after the token is stored and before the mail goes out. */
  readonly onTokenStored?: (stored: {
    readonly token: string;
    readonly ttlSeconds: number;
  }) => Promise<void>;
};

export type IssuedSignupActivation = {
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
};

export async function issueSignupActivation(
  args: IssueSignupActivationArgs,
): Promise<IssuedSignupActivation> {
  const ttlSeconds = (args.tokenTtlMinutes ?? AUTH_SIGNUP_DEFAULT_TTL_MINUTES) * 60;

  // At most one live signup token per email.
  await invalidateExistingSignupToken(args.redis, args.email);
  // 256 bits from node:crypto — never Math.random: xorshift128+ state is
  // reconstructible from a few observed outputs, which would let an attacker
  // predict other users' tokens.
  const token = generateToken();

  const issuedAt = Temporal.Now.instant();
  const expiresAt = issuedAt.add({ seconds: ttlSeconds }).toString();

  await storeSignupToken(args.redis, { email: args.email, token, ttlSeconds });
  await args.onTokenStored?.({ token, ttlSeconds });

  const email = normalizeEmail(args.email);
  await dispatchMagicLinkMail(
    args.notify,
    {
      handlerName: "signup-request",
      notificationType: SIGNUP_ACTIVATION_NOTIFICATION_TYPE,
      renderContent: renderActivationEmail,
    },
    {
      email,
      appUrl: args.appUrl,
      token,
      expiresAt,
      issuedAt: issuedAt.toString(),
      ...(args.timeZone !== undefined && { timeZone: args.timeZone }),
      ...(args.appName !== undefined && { appName: args.appName }),
      ...(args.locale !== undefined && { locale: args.locale }),
    },
  );

  return { email, token, expiresAt };
}
