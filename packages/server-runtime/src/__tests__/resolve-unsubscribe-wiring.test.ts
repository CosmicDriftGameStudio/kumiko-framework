import { describe, expect, test } from "bun:test";
import { DELIVERY_UNSUBSCRIBE_PATH } from "@cosmicdrift/kumiko-bundled-features/delivery";
import { resolveUnsubscribeWiring } from "../resolve-unsubscribe-wiring.js";

const SECRET = "unsubscribe-wiring-test-secret-32-chars-min!";

function resolve(overrides: Partial<Parameters<typeof resolveUnsubscribeWiring>[0]>) {
  const warnings: string[] = [];
  const wiring = resolveUnsubscribeWiring({
    unsubscribe: { secret: SECRET },
    publicOrigin: undefined,
    mailBaseUrl: undefined,
    envSource: {},
    warn: (message) => warnings.push(message),
    ...overrides,
  });
  return { ...wiring, warnings };
}

describe("resolveUnsubscribeWiring", () => {
  test("without the option nothing is wired and nothing is warned", () => {
    const { unsubscribeLinks, unsubscribeRoutes, warnings } = resolve({ unsubscribe: undefined });
    expect(unsubscribeLinks).toBeUndefined();
    expect(unsubscribeRoutes).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test("publicOrigin wins over mail.baseUrl and APP_BASE_URL, reduced to its origin", () => {
    const { unsubscribeLinks, unsubscribeRoutes } = resolve({
      publicOrigin: "https://app.example.eu/some/path",
      mailBaseUrl: "https://mail.example.eu",
      envSource: { APP_BASE_URL: "https://env.example.eu" },
    });
    expect(unsubscribeLinks).toEqual({ secret: SECRET, baseUrl: "https://app.example.eu" });
    expect(unsubscribeRoutes.map((route) => `${route.method} ${route.path}`)).toContain(
      `GET ${DELIVERY_UNSUBSCRIBE_PATH}`,
    );
  });

  test("a local dev URL from APP_BASE_URL is accepted", () => {
    const { unsubscribeLinks } = resolve({ envSource: { APP_BASE_URL: "http://localhost:3000" } });
    expect(unsubscribeLinks?.baseUrl).toBe("http://localhost:3000");
  });

  test("tenantOrigin is passed through to the links", () => {
    const tenantOrigin = async () => null;
    const { unsubscribeLinks } = resolve({
      mailBaseUrl: "https://a.example.eu",
      unsubscribe: { secret: SECRET, tenantOrigin },
    });
    expect(unsubscribeLinks?.tenantOrigin).toBe(tenantOrigin);
  });

  test("without any public URL the routes still mount, links are off and a warning names the options", () => {
    const { unsubscribeLinks, unsubscribeRoutes, warnings } = resolve({});
    expect(unsubscribeLinks).toBeUndefined();
    expect(unsubscribeRoutes.length).toBeGreaterThan(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("APP_BASE_URL");
  });
});
