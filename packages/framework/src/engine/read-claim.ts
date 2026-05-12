import type { ClaimKeyHandle, ClaimKeyJsType, ClaimKeyType, SessionUser } from "./types";

// Read a feature-declared claim from a SessionUser.
//
// The generic is inferred from the handle's `type` literal, so call sites
// get the right narrowed return type without a cast:
//
//   const DriverClaims = r.claimKeys(...);
//   const teamId = readClaim(user, DriverClaims.teamId);    // string | undefined
//   const regionId = readClaim(user, DriverClaims.regionId); // number | undefined
//
// Returns undefined when:
// - user.claims is absent entirely (hook system didn't populate anything)
// - the specific handle's qualified name isn't in user.claims (feature's
//   r.authClaims hook didn't return this inner-key for this user)
//
// The cast is unchecked. The declared handle type is a contract between the
// feature's r.claimKey + r.authClaims return; the resolver's runtime check
// flags drift with a warning, but readClaim itself trusts the declaration.
// If you need schema-level validation of a claim value, wrap it with zod
// at the call-site.
export function readClaim<T extends ClaimKeyType>(
  user: SessionUser,
  handle: ClaimKeyHandle<T>,
): ClaimKeyJsType<T> | undefined {
  const claims = user.claims;
  if (!claims) return undefined;
  const raw = claims[handle.name];
  if (raw === undefined || raw === null) return undefined;
  return raw as ClaimKeyJsType<T>; // @cast-boundary schema-walk
}
