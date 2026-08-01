import { hkdfSync } from "node:crypto";

// HKDF turns one master secret into an independent secret per purpose, so
// a token-signing key for MFA setup can't forge a deletion token and
// neither can be walked back to the master. `purpose` is a domain
// separator, not a label — changing it invalidates every previously
// issued token for that purpose; version it ("mfa-setup-token-v1") to
// rotate one purpose deliberately.
export function derivePurposeSecret(masterSecret: string, purpose: string): string {
  if (!masterSecret) {
    throw new Error("derivePurposeSecret: masterSecret must not be empty.");
  }
  if (!purpose) {
    throw new Error("derivePurposeSecret: purpose must not be empty — it is the domain separator.");
  }
  return Buffer.from(hkdfSync("sha256", masterSecret, "", purpose, 32)).toString("hex");
}
