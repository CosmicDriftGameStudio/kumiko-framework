import { describe, expect, test } from "bun:test";
import { childProcessEnv } from "../child-env";

describe("childProcessEnv", () => {
  test("keeps every entry except the auth token", () => {
    const result = childProcessEnv({
      PUPPETEER_AUTH_TOKEN: "secret-token-0123456789",
      PATH: "/usr/bin",
      HOME: "/home/puppeteer",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
    });
    expect(result).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/puppeteer",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
    });
    expect("PUPPETEER_AUTH_TOKEN" in result).toBe(false);
  });

  test("drops keys whose value is undefined", () => {
    const result = childProcessEnv({ PATH: "/usr/bin", LANG: undefined });
    expect(Object.keys(result)).toEqual(["PATH"]);
  });

  test("does not mutate the source", () => {
    const source = { PUPPETEER_AUTH_TOKEN: "secret-token-0123456789", PATH: "/usr/bin" };
    childProcessEnv(source);
    expect(source.PUPPETEER_AUTH_TOKEN).toBe("secret-token-0123456789");
  });
});
