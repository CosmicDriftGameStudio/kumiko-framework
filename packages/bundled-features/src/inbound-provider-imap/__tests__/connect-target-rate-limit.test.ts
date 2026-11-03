import { describe, expect, test } from "bun:test";
import type { RateLimitBucketRequest } from "@cosmicdrift/kumiko-types/rate-limit-types";
import { enforceConnectTargetLimit } from "../connect-target-rate-limit.ts";
import type { ImapCredentialDocument } from "../credential-document.ts";

async function bucketsFor(host: string): Promise<string[]> {
  const booked: string[] = [];
  await enforceConnectTargetLimit(
    {
      services: {
        rateLimit: {
          enforceAll: async (requests: readonly RateLimitBucketRequest[]) => {
            booked.push(...requests.map((request) => request.bucket));
            return [];
          },
        },
      },
      rateLimitDigest: (value: string) => value,
    } as unknown as Parameters<typeof enforceConnectTargetLimit>[0],
    { host, user: "Box@Example.com" } as ImapCredentialDocument,
  );
  return booked;
}

describe("enforceConnectTargetLimit", () => {
  test("a trailing dot or different case on the host shares the same buckets", async () => {
    expect(await bucketsFor("IMAP.x.com.")).toEqual(await bucketsFor("imap.x.com"));
  });
});
