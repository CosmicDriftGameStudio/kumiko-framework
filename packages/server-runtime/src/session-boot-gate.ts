export type SessionBootGateOptions = {
  readonly hasAuth: boolean;
  readonly sessionStoreProviderMounted: boolean;
  /** prod fails hard on a missing sessionStore provider (stateless JWTs would
   *  silently skip server-side revocation and any session-list UI stays
   *  empty); dev only warns — a forgotten sessions mount in a local sample
   *  app shouldn't crash the dev-server boot, but it must not stay silent
   *  either (#2027 — dev previously had no gate here at all). */
  readonly mode: "prod" | "dev";
};

// Catch a forgotten sessions mount at boot instead of silently degrading
// into stateless JWTs (#1372). Mount createSessionsFeature() for revocable
// sessions; there is no auth.sessions opt-out anymore.
export function assertSessionBootInvariants(opts: SessionBootGateOptions): void {
  // skip: no auth mounted — nothing to gate.
  if (!opts.hasAuth) return;
  // skip: sessionStore provider is wired (sessions feature).
  if (opts.sessionStoreProviderMounted) return;

  const tag = opts.mode === "prod" ? "runProdApp" : "runDevApp";
  const message =
    "auth is mounted but no sessionStore provider is registered. JWTs would be stateless " +
    "(no server-side revocation) and any session-list screen stays empty. Mount " +
    "createSessionsFeature() (@cosmicdrift/kumiko-bundled-features/sessions) alongside auth-foundation.";

  if (opts.mode === "dev") {
    // biome-ignore lint/suspicious/noConsole: boot-time ops warning, no logger configured this early
    console.warn(`[${tag}] ${message}`);
    // skip: dev mode, warning already logged above — never abort dev boot.
    return;
  }
  throw new Error(`[${tag}] BOOT ABORTED — ${message}`);
}
