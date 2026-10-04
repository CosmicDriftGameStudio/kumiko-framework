import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";

// A route that mints a session without passing the MFA gate silently bypasses
// the requiredPolicy. Every session-issuing path must be listed here with the
// way it is gated, so adding a new one forces a conscious decision.

const PACKAGES_DIR = join(import.meta.dir, "..", "packages");
const AUTH_ROUTES_FILE = "framework/src/api/auth-routes.ts";

type MintGate = "handler-gate" | "route-gate" | "second-factor";

const JWT_SIGN_FILES: Record<string, string> = {
  [AUTH_ROUTES_FILE]: "mintSessionAndRespond is the single production mint point",
  "framework/src/stack/request-helper.ts": "test helper signs fixture sessions",
  "dev-server/src/create-kumiko-server.ts":
    "dev server without auth config auto-signs the dev user",
};

const MINTING_ROUTES: Record<string, MintGate> = {
  authLogin: "handler-gate",
  authSignupConfirm: "handler-gate",
  authInviteAcceptWithLogin: "handler-gate",
  authInviteSignupComplete: "handler-gate",
  authSwitchTenant: "route-gate",
  authMfaVerify: "second-factor",
  authMfaPreauthConfirm: "second-factor",
};

function stripComments(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function readCode(relativePath: string): string {
  return stripComments(readFileSync(join(PACKAGES_DIR, relativePath), "utf8"));
}

function productionSourceFiles(): string[] {
  return [...new Glob("*/src/**/*.ts").scanSync({ cwd: PACKAGES_DIR })]
    .filter(
      (f) =>
        !f.includes("__tests__/") &&
        !f.includes("/dist/") &&
        !f.endsWith(".test.ts") &&
        !f.endsWith(".d.ts"),
    )
    .sort();
}

function routeStarts(code: string): { name: string; index: number }[] {
  return [...code.matchAll(/api\.post\(Routes\.(\w+)/g)].map((m) => ({
    name: m[1] as string,
    index: m.index,
  }));
}

function mintingRouteNames(code: string): string[] {
  const starts = routeStarts(code);
  const names = new Set<string>();
  for (const call of code.matchAll(/\bmintSessionAndRespond\(/g)) {
    const owner = starts.filter((s) => s.index < call.index).at(-1);
    // The definition is `function mintSessionAndRespond(` before any route.
    if (owner === undefined) continue;
    names.add(owner.name);
  }
  return [...names].sort();
}

function routeBlock(code: string, routeName: string): string {
  const start = code.indexOf(`api.post(Routes.${routeName}`);
  const rest = code.slice(start + 1);
  const next = rest.search(/api\.(post|get)\(|registerToken\w*Route\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("session minting stays behind the MFA gate", () => {
  it("jwt.sign( appears only in the known files", () => {
    const found = productionSourceFiles().filter((f) =>
      /\bjwt\.sign\(/.test(readCode(f)),
    );
    expect(found).toEqual(Object.keys(JWT_SIGN_FILES).sort());
  });

  it("auth-routes.ts signs exactly once", () => {
    const hits = readCode(AUTH_ROUTES_FILE).match(/\bjwt\.sign\(/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("every route calling mintSessionAndRespond is registered with its MFA gate in MINTING_ROUTES", () => {
    expect(mintingRouteNames(readCode(AUTH_ROUTES_FILE))).toEqual(
      Object.keys(MINTING_ROUTES).sort(),
    );
  });

  it("every mintSessionAndRespond call sits in exactly one listed route", () => {
    const code = readCode(AUTH_ROUTES_FILE);
    const callsIncludingDefinition = code.match(/\bmintSessionAndRespond\(/g) ?? [];
    expect(callsIncludingDefinition).toHaveLength(Object.keys(MINTING_ROUTES).length + 1);
    const firstRoute = routeStarts(code)[0]?.index ?? -1;
    expect(code.indexOf("function mintSessionAndRespond(")).toBeLessThan(firstRoute);
  });

  for (const [routeName, gate] of Object.entries(MINTING_ROUTES)) {
    if (gate === "second-factor") continue;
    it(`${routeName} (${gate}) answers with the MFA setup step`, () => {
      expect(routeBlock(readCode(AUTH_ROUTES_FILE), routeName)).toContain("mfaSetupRequired");
    });
  }
});
