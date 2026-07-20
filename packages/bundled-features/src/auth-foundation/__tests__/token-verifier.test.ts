// resolveTokenVerifier + the tokenVerifier multiplicity boot-check (#1368).
// Mock providers registered via r.useExtension(EXT_TOKEN_VERIFIER, ...) in
// throwaway test-features — no real JWT/PAT provider exists yet.

import { describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createRegistry, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { validateTokenVerifierMultiplicity } from "../boot-checks";
import { authFoundationFeature, resolveTokenVerifier } from "../feature";
import { type AuthProviderPlugin, EXT_TOKEN_VERIFIER } from "../types";

// Mock providers never read `deps.db` — a real provider (personal-access-
// tokens/resolver.ts) does a point-read + live-role-resolution against it.
const fakeDb = {} as DbConnection; // @cast-boundary test fixture, unused by mock providers

function jwtLikeUser(): SessionUser {
  return { id: "u-jwt", tenantId: "t1", roles: ["User"] } as SessionUser; // @cast-boundary test fixture
}

function prefixProvider(entityName: string, prefix: string): ReturnType<typeof defineFeature> {
  const plugin: AuthProviderPlugin = {
    shape: { kind: "prefix", prefix },
    build: () => async (rawToken) => (rawToken === `${prefix}valid` ? jwtLikeUser() : null),
  };
  return defineFeature(`mock-${entityName}`, (r) => {
    r.useExtension(EXT_TOKEN_VERIFIER, entityName, plugin);
  });
}

function jwtProvider(entityName = "jwt-mock"): ReturnType<typeof defineFeature> {
  const plugin: AuthProviderPlugin = {
    shape: { kind: "jwt" },
    build: () => async () => jwtLikeUser(),
  };
  return defineFeature(`mock-${entityName}`, (r) => {
    r.useExtension(EXT_TOKEN_VERIFIER, entityName, plugin);
  });
}

describe("resolveTokenVerifier — middleware finds the matching provider", () => {
  test("routes a prefixed token to the prefix-shape provider", async () => {
    const registry = createRegistry([authFoundationFeature, prefixProvider("pat-mock", "kpat_")]);
    const user = await resolveTokenVerifier({ db: fakeDb, registry }, "kpat_valid");
    expect(user?.id).toBe("u-jwt");
  });

  test("routes a dot-separated token to the jwt-shape provider", async () => {
    const registry = createRegistry([authFoundationFeature, jwtProvider()]);
    const user = await resolveTokenVerifier({ db: fakeDb, registry }, "header.payload.sig");
    expect(user?.id).toBe("u-jwt");
  });

  test("no provider's shape matches → null", async () => {
    const registry = createRegistry([authFoundationFeature, prefixProvider("pat-mock", "kpat_")]);
    const user = await resolveTokenVerifier({ db: fakeDb, registry }, "not-a-pat-token");
    expect(user).toBeNull();
  });

  test("no providers registered at all → null", async () => {
    const registry = createRegistry([authFoundationFeature]);
    const user = await resolveTokenVerifier({ db: fakeDb, registry }, "anything");
    expect(user).toBeNull();
  });
});

describe("validateTokenVerifierMultiplicity", () => {
  test("0 providers registered → throws (fail-fast, no provider to route to)", () => {
    const registry = createRegistry([authFoundationFeature]);
    expect(() => validateTokenVerifierMultiplicity([...registry.features.values()])).toThrow(
      /no tokenVerifier providers registered/,
    );
  });

  test("1 provider per shape → no throw", () => {
    const registry = createRegistry([
      authFoundationFeature,
      jwtProvider(),
      prefixProvider("pat-mock", "kpat_"),
    ]);
    expect(() => validateTokenVerifierMultiplicity([...registry.features.values()])).not.toThrow();
  });

  test("≥2 providers claiming the same shape → throws a conflict error", () => {
    const registry = createRegistry([
      authFoundationFeature,
      jwtProvider("jwt-mock-a"),
      jwtProvider("jwt-mock-b"),
    ]);
    expect(() => validateTokenVerifierMultiplicity([...registry.features.values()])).toThrow(
      /same shape "jwt"/,
    );
  });

  test("wrong-shape registration → throws a malformed-plugin error", () => {
    const broken = defineFeature("mock-broken", (r) => {
      r.useExtension(EXT_TOKEN_VERIFIER, "broken", { shape: { kind: "prefix" } });
    });
    const registry = createRegistry([authFoundationFeature, broken]);
    expect(() => validateTokenVerifierMultiplicity([...registry.features.values()])).toThrow(
      /without a valid AuthProviderPlugin/,
    );
  });

  test("malformed shape (build present, prefix missing) → throws a malformed-plugin error", () => {
    const broken = defineFeature("mock-broken-shape", (r) => {
      r.useExtension(EXT_TOKEN_VERIFIER, "broken-shape", {
        shape: { kind: "prefix" },
        build: () => async () => null,
      });
    });
    const registry = createRegistry([authFoundationFeature, broken]);
    expect(() => validateTokenVerifierMultiplicity([...registry.features.values()])).toThrow(
      /without a valid AuthProviderPlugin/,
    );
  });
});
