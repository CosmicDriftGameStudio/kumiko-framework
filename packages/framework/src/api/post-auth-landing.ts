// Server-computed post-auth redirect target. AuthRoutesConfig.postAuthLanding
// lets an app decide, in ONE place, where a user lands after login/signup/
// invite — instead of every frontend screen re-deriving it from roles/
// tenantId via loggedInHref. The result travels in the JSON response
// (`landingPath`) and is validated here before it ever reaches the wire: an
// app-supplied resolver is untrusted input from the framework's perspective,
// and a bad value would otherwise become a same-response open redirect.

import { createFallbackLogger } from "../logging/index.js";

export type PostAuthLandingFlow = "login" | "signup" | "invite";

export type PostAuthLandingArgs = {
  readonly flow: PostAuthLandingFlow;
  readonly roles: readonly string[];
  readonly tenantId: string;
  // signup only.
  readonly tenantKey?: string;
  // signup only, present when signup-confirm claimed a bound handover grant.
  readonly handover?: { readonly entityType: string; readonly id: string };
};

export type PostAuthLandingResolver = (args: PostAuthLandingArgs) => string | undefined;

function hasControlOrDelCharacter(candidate: string): boolean {
  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// Root-relative-only allowlist, stricter than the framework's existing
// billing isRootRelativePath: rejects protocol-relative ("//host") and
// backslash-based ("/\host") paths a browser would still resolve to a
// different origin, and control chars/whitespace a URL parser silently
// strips (so "/\t/evil.com" would otherwise normalize to "//evil.com" past
// the leading-slash check). The new URL(...) parse is a backstop for
// anything the explicit checks above missed.
export function isSafeLandingPath(candidate: unknown): candidate is string {
  if (typeof candidate !== "string" || candidate.length === 0) return false;
  if (!candidate.startsWith("/")) return false;
  const second = candidate[1];
  if (second === "/" || second === "\\") return false;
  if (candidate.includes("\\")) return false;
  if (hasControlOrDelCharacter(candidate)) return false;
  if (/\s/.test(candidate)) return false;
  try {
    const parsed = new URL(candidate, "https://landing.invalid");
    if (parsed.origin !== "https://landing.invalid") return false;
    // "/.//evil.com" clears every check above (no leading "//", no
    // backslash) but normalizes to pathname "//evil.com" — still same-
    // origin on first navigation, but protocol-relative if a caller ever
    // re-resolves the bare pathname as a fresh href.
    return !parsed.pathname.startsWith("//");
  } catch {
    return false;
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

const landingLog = createFallbackLogger("auth");

export function resolvePostAuthLandingPath(
  resolver: PostAuthLandingResolver | undefined,
  args: PostAuthLandingArgs,
): string | undefined {
  if (!resolver) return undefined;
  let candidate: unknown;
  try {
    candidate = resolver(args);
  } catch (error) {
    // Consumer error messages can carry PII or secrets; log only the error class.
    landingLog.warn("postAuthLanding threw — landingPath omitted", {
      flow: args.flow,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return undefined;
  }
  if (isThenable(candidate)) {
    // A JS consumer (or a cast) can bypass the sync signature; an unobserved
    // rejection would terminate the Bun process on every login.
    Promise.resolve(candidate).catch(() => undefined);
    landingLog.warn("postAuthLanding async resolver not supported — landingPath omitted", {
      flow: args.flow,
    });
    return undefined;
  }
  if (candidate === undefined) return undefined;
  if (!isSafeLandingPath(candidate)) {
    landingLog.warn("postAuthLanding returned an unsafe path — landingPath omitted", {
      flow: args.flow,
    });
    return undefined;
  }
  return candidate;
}
