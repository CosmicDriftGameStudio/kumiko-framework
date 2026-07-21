import type { ProdSessionsOption } from "./session-wiring";

export type SessionBootGateOptions = {
  readonly hasAuth: boolean;
  readonly sessionsFeatureMounted: boolean;
  readonly sessionsOption: ProdSessionsOption | undefined;
};

// Mirrors pii-boot-gate.ts: catch a forgotten wiring at boot instead of
// letting it degrade silently into stateless JWTs (no server-side
// revocation, valid for the full 24h token TTL). `auth.sessions: false` is
// already the sanctioned opt-out (see session-wiring.ts) — reusing it here
// instead of inventing a second acknowledgment param.
export function assertSessionBootInvariants(opts: SessionBootGateOptions): void {
  // skip: no auth mounted — nothing to gate.
  if (!opts.hasAuth) return;
  // skip: explicit opt-out, operator acknowledged stateless JWTs.
  if (opts.sessionsOption === false) return;
  // skip: sessions feature is wired.
  if (opts.sessionsFeatureMounted) return;

  throw new Error(
    "[runProdApp] BOOT ABORTED — auth is mounted but the `sessions` feature is not. " +
      "JWTs would be stateless (no server-side revocation, valid until the 24h expiry) " +
      "with no warning. Mount createSessionsFeature() " +
      "(@cosmicdrift/kumiko-bundled-features/sessions) for revocable sessions, or pass " +
      "{ auth: { sessions: false } } to acknowledge stateless JWTs are intentional.",
  );
}
