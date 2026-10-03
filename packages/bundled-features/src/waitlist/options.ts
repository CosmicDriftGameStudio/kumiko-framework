import type { HandlerContext, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { PayloadRateLimitOption, RateLimitOption } from "@cosmicdrift/kumiko-types/handlers";

export type WaitlistInviteOptions =
  | {
      /** Each invited entry gets its own tenant, named after company or name. */
      readonly mode: "own-tenant";
      /** Membership role in the new tenant. Default "TenantAdmin". */
      readonly role?: string;
    }
  | {
      /** Every invited entry joins one existing tenant. */
      readonly mode: "shared-tenant";
      readonly tenantId: TenantId;
      readonly role: string;
    };

export type WaitlistOptions = {
  /** Address for an admin notification mail on each new entry. Null, an empty
   *  string or an absent option sends none. Best effort, never fails the submit. */
  readonly notifyRecipient?: (ctx: HandlerContext) => string | null;
  /** Default `{ mode: "own-tenant", role: "TenantAdmin" }`. */
  readonly invite?: WaitlistInviteOptions;
  /** Default: 5 submits per IP per 10 minutes. */
  readonly rateLimit?: RateLimitOption;
  /** Default: 3 submits per email address per day, across all IPs. Stops a botnet
   *  from flooding one address with confirmation mails. Pass `[]` to disable. */
  readonly emailRateLimits?: readonly PayloadRateLimitOption[];
  /** Shown in the confirmation mail; omitted when unset. */
  readonly appName?: string;
};

export const DEFAULT_SUBMIT_RATE_LIMIT: RateLimitOption = {
  per: "ip+handler",
  limit: 5,
  windowSeconds: 10 * 60,
};

export const DEFAULT_SUBMIT_EMAIL_RATE_LIMITS: readonly PayloadRateLimitOption[] = [
  { per: { payloadField: "email" }, limit: 3, windowSeconds: 24 * 60 * 60 },
];
