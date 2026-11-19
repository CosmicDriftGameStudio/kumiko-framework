import { createHmac } from "node:crypto";
import { derivePurposeSecret } from "../secrets/derive-purpose-secret.ts";

const VISITOR_KEY_PURPOSE = "kumiko:visitor-key";

export function createVisitorKeyDigest(masterSecret: string): (value: string) => string {
  const key = derivePurposeSecret(masterSecret, VISITOR_KEY_PURPOSE);
  return (value) => createHmac("sha256", key).update(value).digest("hex");
}
