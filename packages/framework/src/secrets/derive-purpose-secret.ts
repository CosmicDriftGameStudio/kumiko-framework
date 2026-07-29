import { hkdfSync } from "node:crypto";

// One master secret, many purposes: HKDF turns `JWT_SECRET` into an
// independent secret per trust boundary, so a token-signing key for MFA setup
// cannot be used to forge a deletion token — and neither can be walked back to
// the master. Rotating the master rotates every purpose with it.
//
// The alternative is an env var per purpose. That is not more secure (same
// blast radius if the deploy is compromised), it is just more operations, and
// in practice one of them ends up unset in some environment.
//
// The purpose string is a domain separator and part of the contract: change it
// and every previously issued token for that purpose stops verifying. Version
// them ("mfa-setup-token-v1") so a single purpose can be rotated deliberately
// without touching the master or the other purposes.
//
// Lived copy-pasted in four apps before fw#1623 (money-horse, kumiko-studio,
// publicstatus, plus a stale worktree) — identical bodies, drifting comments.
export function derivePurposeSecret(masterSecret: string, purpose: string): string {
  if (!masterSecret) {
    throw new Error("derivePurposeSecret: masterSecret must not be empty.");
  }
  if (!purpose) {
    throw new Error("derivePurposeSecret: purpose must not be empty — it is the domain separator.");
  }
  return Buffer.from(hkdfSync("sha256", masterSecret, "", purpose, 32)).toString("hex");
}
