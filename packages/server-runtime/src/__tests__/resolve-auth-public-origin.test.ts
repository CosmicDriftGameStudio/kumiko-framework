import { describe, expect, test } from "bun:test";
import { APP_BASE_URL_ENV, resolveAuthPublicOrigin } from "../resolve-auth-public-origin.js";

const PROD = { NODE_ENV: "production" };

function resolveWithWarnings(
  auth: Parameters<typeof resolveAuthPublicOrigin>[0],
  env: Record<string, string | undefined>,
): { origin: string | undefined; warnings: string[] } {
  const warnings: string[] = [];
  const origin = resolveAuthPublicOrigin(auth, env, (message) => warnings.push(message));
  return { origin, warnings };
}

describe("resolveAuthPublicOrigin", () => {
  test("derives the origin from the auth mail base URL, path and case dropped", () => {
    const { origin, warnings } = resolveWithWarnings(
      { mail: { baseUrl: "https://App.Example.eu/admin/" } },
      { ...PROD, [APP_BASE_URL_ENV]: "https://other.example.eu" },
    );
    expect(origin).toBe("https://app.example.eu");
    expect(warnings).toEqual([]);
  });

  test("falls back to APP_BASE_URL when no mail block is configured", () => {
    const { origin } = resolveWithWarnings(
      {},
      { ...PROD, [APP_BASE_URL_ENV]: "https://a.example.eu" },
    );
    expect(origin).toBe("https://a.example.eu");
  });

  test("an explicit allowlist or opt-out leaves the derived default out", () => {
    const env = { ...PROD, [APP_BASE_URL_ENV]: "https://a.example.eu" };
    expect(resolveWithWarnings({ allowedOrigins: ["https://b.example.eu"] }, env).origin).toBe(
      undefined,
    );
    expect(resolveWithWarnings({ unsafeSkipOriginCheck: true }, env).origin).toBe(undefined);
  });

  test("warns in production when no URL is known, without throwing", () => {
    const { origin, warnings } = resolveWithWarnings({}, PROD);
    expect(origin).toBe(undefined);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Origin guard is OFF");
  });

  test("an unparsable URL is treated as missing", () => {
    const { origin, warnings } = resolveWithWarnings(
      {},
      { ...PROD, [APP_BASE_URL_ENV]: "app.example.eu" },
    );
    expect(origin).toBe(undefined);
    expect(warnings).toHaveLength(1);
  });

  test("stays quiet outside production", () => {
    expect(resolveWithWarnings({}, { NODE_ENV: "test" }).warnings).toEqual([]);
  });
});
