import type {
  PayloadRateLimitOption,
  RateLimitDeclaration,
  RateLimitOption,
} from "@cosmicdrift/kumiko-types/handlers";
import {
  CONTACT_DEFAULT_CHALLENGE_TTL_MINUTES,
  CONTACT_DEFAULT_MIN_SUBMIT_SECONDS,
  CONTACT_POW_BITS,
  type ContactPhoneMode,
} from "./web/constants.ts";

export type ContactOptions = {
  /** Name shown in the notification mails ("Testnachricht von <appName>") and in the hint of the report form. */
  readonly appName: string;
  /** Default { phone: "off" }. Controls both the public form (challenge query reports it) and the admin report form. */
  readonly fields?: { readonly phone?: ContactPhoneMode };
  /** Shown as "Version" in the request origin; omitted when unset. */
  readonly appVersion?: string;
  /** Default false. true requires channel-telegram and adds the `telegramChat` config key, the `send-test` handler and the forward to that chat. */
  readonly telegram?: boolean;
  /** Screen the admin report form's Cancel button navigates to (short id or `<feature>:screen:<id>`). Default: no Cancel button. */
  readonly reportCancelTarget?: string;
  /** Screens the sender and tenant links in the request detail header open (short id or `<feature>:screen:<id>`). Default `user-edit` and `tenant-edit`; `false` shows plain text. */
  readonly detailLinks?: {
    readonly user?: string | false;
    readonly tenant?: string | false;
  };
  /** Language of the notification mails and Telegram texts SystemAdmins receive. Default "en". */
  readonly adminLocale?: string;
  /** Deep link to the request in the admin, put into the notification mail and the Telegram text. Omitted: no link. */
  readonly requestLink?: (requestId: string) => string;
  /** Per-IP limit of the public submit. Default 5 per IP per 10 minutes. */
  readonly rateLimit?: RateLimitDeclaration;
  /** Default: 3 per email address per day. `[]` disables. */
  readonly emailRateLimits?: readonly PayloadRateLimitOption[];
  readonly spamProtection?: {
    /** Default 3. Submits faster than this after the challenge was issued are silently dropped. */
    readonly minSubmitSeconds?: number;
    /** Leading zero bits of SHA-256(challenge + ":" + nonce). Default 19, min 8, max 26. */
    readonly proofOfWorkBits?: number;
    /** Default 30. */
    readonly challengeTtlMinutes?: number;
  };
  /** Retention of requests and replies, data-retention keepFor syntax. Default "365d" counted from submittedAt. */
  readonly retentionKeepFor?: string;
};

export const DEFAULT_SUBMIT_RATE_LIMIT: RateLimitOption = {
  per: "ip+handler",
  limit: 5,
  windowSeconds: 10 * 60,
};

export const REPORT_RATE_LIMIT: RateLimitOption = {
  per: "user+handler",
  limit: 10,
  windowSeconds: 60 * 60,
};

export const CHALLENGE_RATE_LIMIT: RateLimitOption = {
  per: "ip+handler",
  limit: 30,
  windowSeconds: 10 * 60,
};

export const DEFAULT_SUBMIT_EMAIL_RATE_LIMITS: readonly PayloadRateLimitOption[] = [
  { per: { payloadField: "email" }, limit: 3, windowSeconds: 24 * 60 * 60, normalize: "email" },
];

export const DEFAULT_RETENTION_KEEP_FOR = "365d";

export type ContactSettings = {
  readonly phone: ContactPhoneMode;
  readonly proofOfWorkBits: number;
  readonly minSubmitMs: number;
  readonly challengeTtlSeconds: number;
};

export function resolveContactSettings(opts: ContactOptions): ContactSettings {
  const bits = opts.spamProtection?.proofOfWorkBits ?? CONTACT_POW_BITS.default;
  if (!Number.isInteger(bits) || bits < CONTACT_POW_BITS.min || bits > CONTACT_POW_BITS.max) {
    throw new Error(
      `contact: spamProtection.proofOfWorkBits must be an integer between ${CONTACT_POW_BITS.min} and ${CONTACT_POW_BITS.max}, got ${bits}`,
    );
  }
  return {
    phone: opts.fields?.phone ?? "off",
    proofOfWorkBits: bits,
    minSubmitMs:
      (opts.spamProtection?.minSubmitSeconds ?? CONTACT_DEFAULT_MIN_SUBMIT_SECONDS) * 1000,
    challengeTtlSeconds:
      (opts.spamProtection?.challengeTtlMinutes ?? CONTACT_DEFAULT_CHALLENGE_TTL_MINUTES) * 60,
  };
}
