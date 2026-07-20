import * as jose from "jose";
import type { DbRow } from "../db/connection";
import type { SessionUser, TenantId } from "../engine/types";
import { parseTenantId } from "../engine/types";

export type JwtPayload = {
  // JWT `sub` is a string per RFC 7519. Matches SessionUser.id — a UUID-string
  // under the ES migration. `sign()` already stringifies via String(user.id);
  // `verify()` just passes it through.
  sub: string;
  tenantId: TenantId;
  roles: string[];
  // Optional — present when a feature has registered auth claims via the
  // `r.authClaims()` hook system. Absent for stateless-JWT deployments
  // without auth-claims wiring.
  claims?: Record<string, unknown>;
  // Optional session-ID, carried in the standard `jti` JWT claim.
  // Present when the app wires a `sessionCreator` callback (see sessions
  // feature). Absent → stateless-JWT mode, no revocation possible.
  jti?: string;
};

export type JwtHelper = {
  sign(user: SessionUser): Promise<string>;
  verify(token: string): Promise<JwtPayload>;
};

// kid → secret. All entries verify; `signKid` picks the sign-key. Rotation:
// add the new kid, flip signKid, keep the old kid around until in-flight
// tokens expire.
export type JwtKeyring = {
  readonly keys: Readonly<Record<string, string>>;
  readonly signKid: string;
};

type NormalizedKeyring = {
  readonly verifyKeys: ReadonlyMap<string, Uint8Array>;
  readonly signKid: string | undefined;
  readonly signKey: Uint8Array;
};

function normalizeKeyring(secretOrKeyring: string | JwtKeyring): NormalizedKeyring {
  if (typeof secretOrKeyring === "string") {
    const key = new TextEncoder().encode(secretOrKeyring);
    return { verifyKeys: new Map(), signKid: undefined, signKey: key };
  }

  const verifyKeys = new Map<string, Uint8Array>();
  for (const [kid, secret] of Object.entries(secretOrKeyring.keys)) {
    verifyKeys.set(kid, new TextEncoder().encode(secret));
  }
  const signKey = verifyKeys.get(secretOrKeyring.signKid);
  if (!signKey) {
    throw new Error(
      `createJwtHelper: signKid "${secretOrKeyring.signKid}" is not present in the keyring`,
    );
  }
  return { verifyKeys, signKid: secretOrKeyring.signKid, signKey };
}

// Tokens carry `kid` in the protected header when signed from a keyring — pick the
// matching verify-key directly. Tokens without `kid` (single-secret form, or in-flight
// tokens signed before a rotation) fall back to trying every verify-key.
async function verifyWithKeyring(token: string, keyring: NormalizedKeyring, issuer: string) {
  const { kid } = jose.decodeProtectedHeader(token);
  if (typeof kid === "string" && keyring.verifyKeys.size > 0) {
    const key = keyring.verifyKeys.get(kid);
    if (!key) {
      throw new Error(`JWT verification failed: unknown kid "${kid}"`);
    }
    return jose.jwtVerify(token, key, { issuer });
  }

  // ponytail: tries every key in the ring (O(keys) per legacy-token verify) — fine for a
  // rotation window of a handful of keys, revisit if the keyring ever grows large.
  const candidates =
    keyring.verifyKeys.size > 0 ? [...keyring.verifyKeys.values()] : [keyring.signKey];
  let lastError: unknown;
  for (const key of candidates) {
    try {
      return await jose.jwtVerify(token, key, { issuer });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("JWT verification failed: no matching key");
}

export function createJwtHelper(
  secretOrKeyring: string | JwtKeyring,
  issuer = "kumiko",
): JwtHelper {
  const keyring = normalizeKeyring(secretOrKeyring);

  return {
    async sign(user) {
      const body: Omit<JwtPayload, "sub" | "jti"> = {
        tenantId: user.tenantId,
        roles: [...user.roles],
      };
      if (user.claims) body.claims = { ...user.claims };

      const header: jose.JWTHeaderParameters = keyring.signKid
        ? { alg: "HS256", kid: keyring.signKid }
        : { alg: "HS256" };

      const builder = new jose.SignJWT(body)
        .setProtectedHeader(header)
        .setSubject(String(user.id))
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("24h");
      if (user.sid) builder.setJti(user.sid);

      return builder.sign(keyring.signKey);
    },

    async verify(token) {
      const { payload } = await verifyWithKeyring(token, keyring, issuer);

      // defence-in-depth: valid sig ≠ well-formed claims; malformed payload → throw → 401
      const tenantId = parseTenantId(payload["tenantId"]);
      if (tenantId === null) {
        throw new Error("JWT payload validation failed: tenantId claim is missing or malformed");
      }
      const rawRoles = payload["roles"];
      if (!Array.isArray(rawRoles)) {
        throw new Error("JWT payload validation failed: roles claim must be an array");
      }
      const roles: string[] = [];
      for (const role of rawRoles) {
        if (typeof role !== "string") {
          throw new Error("JWT payload validation failed: roles must contain only strings");
        }
        roles.push(role);
      }
      if (typeof payload.sub !== "string" || payload.sub === "") {
        throw new Error("JWT payload validation failed: sub claim is missing or malformed");
      }

      const result: JwtPayload = {
        sub: payload.sub,
        tenantId,
        roles,
      };
      const claims = payload["claims"];
      if (claims && typeof claims === "object") {
        result.claims = claims as DbRow;
      }
      if (typeof payload.jti === "string") {
        result.jti = payload.jti;
      }
      return result;
    },
  };
}

const JWT_KEY_VAR_PATTERN = /^JWT_SECRET_V(\d+)$/;
const JWT_CURRENT_VERSION_VAR = "JWT_SECRET_CURRENT_VERSION";
// Mirrors authEmailPasswordEnvSchema's JWT_SECRET.min(32) — HS256 minimum.
// JWT_SECRET_V<n> bypasses that zod schema entirely (it only validates the
// plain JWT_SECRET name), so this loader is the only gate for the rotation path.
const MIN_JWT_SECRET_LENGTH = 32;

function assertMinLength(name: string, value: string): void {
  if (value.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`[jwt] ${name} must be ≥${MIN_JWT_SECRET_LENGTH} chars (HS256 minimum)`);
  }
}

// Env-loader for createJwtHelper's secret-or-keyring param, analog to
// secrets' loadKeyring: JWT_SECRET_V<n> (+ JWT_SECRET_CURRENT_VERSION picking
// the active signKid) for rotation, falling back to plain JWT_SECRET when no
// JWT_SECRET_V<n> is set — so a non-rotating deployment needs no new env vars.
export function loadJwtSecretOrKeyring(
  env: Readonly<Record<string, string | undefined>>,
): string | JwtKeyring {
  const keys: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(JWT_KEY_VAR_PATTERN);
    if (!match || !value) continue;
    assertMinLength(name, value);
    // biome-ignore lint/style/noNonNullAssertion: regex group 1 always present
    keys[`v${match[1]!}`] = value;
  }

  // skip: no JWT_SECRET_V<n> found — single-secret fallback.
  if (Object.keys(keys).length === 0) {
    const secret = env["JWT_SECRET"];
    if (!secret) {
      throw new Error(
        "[jwt] JWT_SECRET not set — set JWT_SECRET for a single key, or " +
          "JWT_SECRET_V1 (+ JWT_SECRET_CURRENT_VERSION=1) for a rotatable keyring.",
      );
    }
    assertMinLength("JWT_SECRET", secret);
    return secret;
  }

  const currentRaw = env[JWT_CURRENT_VERSION_VAR];
  if (!currentRaw) {
    throw new Error(
      `[jwt] ${JWT_CURRENT_VERSION_VAR} not set — explicit current-version required ` +
        "so adding a new JWT_SECRET_V<n> doesn't auto-promote it to the sign key.",
    );
  }
  const signKid = `v${currentRaw}`;
  if (!keys[signKid]) {
    throw new Error(
      `[jwt] ${JWT_CURRENT_VERSION_VAR}="${currentRaw}" not present in the keyring ` +
        `(have versions: ${Object.keys(keys).sort().join(", ")}). ` +
        `Check JWT_SECRET_V${currentRaw} is set.`,
    );
  }
  return { keys, signKid };
}
