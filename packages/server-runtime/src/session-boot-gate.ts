export type SessionBootGateOptions = {
  readonly hasAuth: boolean;
  readonly sessionStoreProviderMounted: boolean;
};

// Catch a forgotten sessions mount at boot instead of silently degrading
// into stateless JWTs (#1372). Mount createSessionsFeature() for revocable
// sessions; there is no auth.sessions opt-out anymore.
export function assertSessionBootInvariants(opts: SessionBootGateOptions): void {
  // skip: no auth mounted — nothing to gate.
  if (!opts.hasAuth) return;
  // skip: sessionStore provider is wired (sessions feature).
  if (opts.sessionStoreProviderMounted) return;

  throw new Error(
    "[runProdApp] BOOT ABORTED — auth is mounted but no sessionStore provider is registered. " +
      "JWTs would be stateless (no server-side revocation). Mount createSessionsFeature() " +
      "(@cosmicdrift/kumiko-bundled-features/sessions) alongside auth-foundation.",
  );
}
