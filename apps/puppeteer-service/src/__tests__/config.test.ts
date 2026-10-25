import { describe, expect, test } from "bun:test";
import { loadConfig } from "../config";

describe("loadConfig", () => {
  const VALID_TOKEN = "0123456789abcdef0123456789abcdef";

  test("token >=16 chars required", () => {
    expect(() => loadConfig({ PUPPETEER_AUTH_TOKEN: "short" })).toThrow(/16 chars/);
  });

  test("token missing throws", () => {
    expect(() => loadConfig({})).toThrow(/missing/);
  });

  test("loads defaults", () => {
    const config = loadConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN });
    expect(config.port).toBe(3000);
    expect(config.renderTimeoutMs).toBe(30_000);
    expect(config.maxHtmlBytes).toBe(2_000_000);
  });

  test("env-overrides", () => {
    const config = loadConfig({
      PUPPETEER_AUTH_TOKEN: VALID_TOKEN,
      PORT: "8080",
      RENDER_TIMEOUT_MS: "10000",
      MAX_HTML_BYTES: "500000",
    });
    expect(config.port).toBe(8080);
    expect(config.renderTimeoutMs).toBe(10_000);
    expect(config.maxHtmlBytes).toBe(500_000);
  });

  test("rejects non-positive integers", () => {
    expect(() => loadConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN, RENDER_TIMEOUT_MS: "0" })).toThrow(
      /positive/,
    );
    expect(() => loadConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN, PORT: "-1" })).toThrow(/positive/);
    expect(() => loadConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN, PORT: "abc" })).toThrow(
      /positive/,
    );
  });

  test("optional executablePath remains undefined", () => {
    const config = loadConfig({ PUPPETEER_AUTH_TOKEN: VALID_TOKEN });
    expect(config.puppeteerExecutablePath).toBeUndefined();
  });
});
