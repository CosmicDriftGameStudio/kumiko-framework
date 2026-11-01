import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { issueChallenge } from "../challenge.ts";
import { CHALLENGE_RATE_LIMIT, type ContactSettings } from "../options.ts";
import { ContactEmptySchema } from "../payloads.ts";
import { CONTACT_WEBSITE_KINDS, type ContactPhoneMode } from "../web/constants.ts";
import { SUBMIT_ROLES } from "./access.ts";

export type ContactChallengeData = {
  readonly challenge: string;
  readonly bits: number;
  readonly phone: ContactPhoneMode;
  readonly kinds: readonly string[];
};

export function createChallengeQuery(settings: ContactSettings) {
  return defineQueryHandler({
    name: "challenge",
    schema: ContactEmptySchema,
    access: { roles: SUBMIT_ROLES, personalData: "public-intake", anySignedIn: true },
    rateLimit: CHALLENGE_RATE_LIMIT,
    agent: { expose: false },
    description:
      "Public contact form bootstrap: issues a single-use proof-of-work challenge and reports which fields the form shows (phone mode, request kinds).",
    handler: async (_event, ctx): Promise<ContactChallengeData> => {
      if (!ctx.services.redis) {
        throw new InternalError({
          message: "contact:challenge requires ctx.services.redis for the challenge store",
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
        kinds: CONTACT_WEBSITE_KINDS,
      };
    },
  });
}
