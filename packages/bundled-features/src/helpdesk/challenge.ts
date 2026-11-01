import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import * as z from "zod";
import { HELPDESK_CHALLENGE_REDIS_PREFIX } from "./web/constants.ts";

const CHALLENGE_BYTES = 16;

const StoredChallengeSchema = z.object({
  issuedAtMs: z.number().int().nonnegative(),
  bits: z.number().int().positive(),
});
export type StoredChallenge = z.infer<typeof StoredChallengeSchema>;

const challengeKey = (challenge: string) => `${HELPDESK_CHALLENGE_REDIS_PREFIX}${challenge}`;

export async function issueChallenge(
  redis: Redis,
  args: { readonly bits: number; readonly ttlSeconds: number; readonly nowMs: number },
): Promise<string> {
  const challenge = randomBytes(CHALLENGE_BYTES).toString("base64url");
  const stored: StoredChallenge = { issuedAtMs: args.nowMs, bits: args.bits };
  await redis.set(challengeKey(challenge), JSON.stringify(stored), "EX", args.ttlSeconds);
  return challenge;
}

// GETDEL makes the challenge single-use even when the submit is rejected afterwards.
export async function consumeChallenge(
  redis: Redis,
  challenge: string,
): Promise<StoredChallenge | null> {
  const raw = await redis.getdel(challengeKey(challenge));
  if (raw === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = StoredChallengeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
