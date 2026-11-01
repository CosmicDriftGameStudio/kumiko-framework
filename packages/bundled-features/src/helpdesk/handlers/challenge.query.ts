import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { issueChallenge } from "../challenge.ts";
import { CHALLENGE_RATE_LIMIT, type HelpdeskSettings } from "../options.ts";
import { HelpdeskEmptySchema } from "../payloads.ts";
import { HELPDESK_WEBSITE_KINDS, type HelpdeskPhoneMode } from "../web/constants.ts";
import { SUBMIT_ROLES } from "./access.ts";

export type HelpdeskChallengeData = {
  readonly challenge: string;
  readonly bits: number;
  readonly phone: HelpdeskPhoneMode;
  readonly kinds: readonly string[];
};

export function createChallengeQuery(settings: HelpdeskSettings) {
  return defineQueryHandler({
    name: "challenge",
    schema: HelpdeskEmptySchema,
    access: { roles: SUBMIT_ROLES, personalData: "public-intake", anySignedIn: true },
    rateLimit: CHALLENGE_RATE_LIMIT,
    agent: { expose: false },
    description:
      "Public contact form bootstrap: issues a single-use proof-of-work challenge and reports which fields the form shows (phone mode, request kinds).",
    handler: async (_event, ctx): Promise<HelpdeskChallengeData> => {
      if (!ctx.services.redis) {
        throw new InternalError({
          message: "helpdesk:challenge requires ctx.services.redis for the challenge store",
        });
      }
      const challenge = await issueChallenge(ctx.services.redis, {
        bits: settings.proofOfWorkBits,
        ttlSeconds: settings.challengeTtlSeconds,
        nowMs: ctx.tz.now().epochMilliseconds,
      });
      return {
        challenge,
        bits: settings.proofOfWorkBits,
        phone: settings.phone,
        kinds: HELPDESK_WEBSITE_KINDS,
      };
    },
  });
}
