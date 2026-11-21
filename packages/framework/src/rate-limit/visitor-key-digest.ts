import { createPurposeDigest } from "../secrets/derive-purpose-secret.ts";

const VISITOR_KEY_PURPOSE = "kumiko:visitor-key";

export function createVisitorKeyDigest(masterSecret: string): (value: string) => string {
  return createPurposeDigest(masterSecret, VISITOR_KEY_PURPOSE);
}
