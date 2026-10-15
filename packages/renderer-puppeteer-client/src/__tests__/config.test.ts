import { describe, expect, test } from "bun:test";
import { loadClientConfig } from "../config";

const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

describe("loadClientConfig", () => {
  test("token >=16 chars required", () => {
    expect(() => loadClientConfig({ PUPPETEER_AUTH_TOKEN: "short" })).toThrow(/16 chars/);
  });

  test("token missing throws", () => {
    expect(() => loadClientConfig({})).toThrow(/missing/);
  });

  test("default service URL when env empty", () => {
    const config = loadClientConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN });
    expect(config.serviceUrl).toBe("http://puppeteer-service:3000");
  });

  test("custom service URL with trailing slash trimmed", () => {
    const config = loadClientConfig({
      PUPPETEER_AUTH_TOKEN: VALID_TOKEN,
      PUPPETEER_SERVICE_URL: "https://render.example.com/",
    });
    expect(config.serviceUrl).toBe("https://render.example.com");
  });

  test("custom timeout + retries via env", () => {
    const config = loadClientConfig({
      PUPPETEER_AUTH_TOKEN: VALID_TOKEN,
      PUPPETEER_CLIENT_TIMEOUT_MS: "10000",
      PUPPETEER_CLIENT_MAX_RETRIES: "5",
    });
    expect(config.requestTimeoutMs).toBe(10_000);
    expect(config.maxRetries).toBe(5);
  });

  test("maxRetries=0 is valid (no retry)", () => {
    const config = loadClientConfig({
      PUPPETEER_AUTH_TOKEN: VALID_TOKEN,
      PUPPETEER_CLIENT_MAX_RETRIES: "0",
    });
    expect(config.maxRetries).toBe(0);
  });

  test("negative timeout throws", () => {
    expect(() =>
      loadClientConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN, PUPPETEER_CLIENT_TIMEOUT_MS: "-1" }),
    ).toThrow(/non-negative/);
  });
});
