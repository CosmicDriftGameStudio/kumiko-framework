import type { AuthClaimsContext, AuthClaimsHookDef, SessionUser } from "../engine/types";
import type { Logger } from "../logging/types";

// Shape the dispatcher (or a test harness) has to hand in: a way to build the
// per-hook context and the list of registered hooks. Staying off the
// Dispatcher/Registry types here keeps this utility trivially unit-testable —
// a fake `hooks` array + a stub `contextFactory` and you can assert the merge
// policy without spinning up Drizzle, Redis, or anything else.
export type ResolveAuthClaimsArgs = {
  readonly user: SessionUser;
  readonly hooks: readonly AuthClaimsHookDef[];
  readonly contextFactory: (user: SessionUser) => AuthClaimsContext;
  readonly log?: Logger;
};

// Run every registered r.authClaims() hook in parallel and merge the results
// into a single claim record.
//
// Key policy:
// - Auto-prefix: each key a hook returns is stored as `"<featureName>:<key>"`.
//   Cross-feature collisions are impossible by construction.
// - Same-feature duplicate key (two hooks in one feature both return the same
//   inner key, or one hook returns the same key twice): last-wins. Matches
//   the `{ ...payload.claims }` spread the JWT layer already does.
// - Reserved separator: we skip any key returned by a hook that itself
//   contains `":"` and log a warning. The separator is the framework's —
//   claim-returning code must own the *inner* name, not the prefix.
//
// Error policy: best-effort. If a hook throws, the error is logged and that
// feature's claims just don't end up in the record. Login still succeeds.
// Rationale: claims are convenience identity-facts, not access-gates.
// Security decisions must go through `roles` + field-access rules, both of
// which are unaffected by a missing claim.
export async function resolveAuthClaims(
  args: ResolveAuthClaimsArgs,
): Promise<Record<string, unknown>> {
  if (args.hooks.length === 0) return {};

  const ctx = args.contextFactory(args.user);

  const results = await Promise.allSettled(
    args.hooks.map((h) => runSingleHook(h, args.user, ctx, args.log)),
  );

  const merged: Record<string, unknown> = {};
  for (let i = 0; i < results.length; i++) {
    const hook = args.hooks[i];
    if (!hook) continue;
    const result = results[i];
    if (!result) continue;
    if (result.status === "rejected") {
      // Already logged in runSingleHook's catch — Promise.allSettled just
      // surfaces it here so the rest of the merge keeps going.
      continue;
    }
    const claims = result.value;
    for (const [innerKey, value] of Object.entries(claims)) {
      if (innerKey.includes(":")) {
        args.log?.warn("r.authClaims return key contains reserved separator ':' — dropping", {
          featureName: hook.featureName,
          rejectedKey: innerKey,
        });
        continue;
      }
      // Typo / rename drift check: when the feature declared its claim
      // vocabulary via r.claimKey(), any hook return-key outside that
      // vocabulary is almost certainly a mistake (forgot to declare,
      // renamed one side but not the other). We still merge it — best-
      // effort matches the error policy — but log a warning so it surfaces.
      //
      // `declaredKeys` is undefined when the feature never called
      // r.claimKey(), keeping legacy hooks silent (opt-in to the check).
      if (hook.declaredKeys && !hook.declaredKeys.has(innerKey)) {
        args.log?.warn(
          "r.authClaims returned an inner-key that was not declared via r.claimKey()",
          { featureName: hook.featureName, undeclaredKey: innerKey },
        );
      }
      const prefixed = `${hook.featureName}:${innerKey}`;
      merged[prefixed] = value;
    }
  }
  return merged;
}

// Isolate the try/catch so the calling Promise.allSettled only sees success
// values — keeps the merge loop straightforward.
async function runSingleHook(
  hook: AuthClaimsHookDef,
  user: SessionUser,
  ctx: AuthClaimsContext,
  log: Logger | undefined,
): Promise<Record<string, unknown>> {
  try {
    return await hook.fn(user, ctx);
  } catch (err) {
    log?.warn("r.authClaims hook threw — dropping this feature's claims for this login", {
      featureName: hook.featureName,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
