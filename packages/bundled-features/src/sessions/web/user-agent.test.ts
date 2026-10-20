import { describe, expect, test } from "bun:test";
import { parseUserAgent } from "./user-agent.ts";

const REAL_USER_AGENTS = [
  {
    name: "Firefox on macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    expected: { browser: "Firefox", browserMajor: 132, os: "macOS" },
  },
  {
    name: "Safari on iPhone",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    expected: { browser: "Safari", browserMajor: 17, os: "iOS" },
  },
  {
    name: "Chrome on Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    expected: { browser: "Chrome", browserMajor: 131, os: "Windows" },
  },
  {
    name: "Edge on Windows",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    expected: { browser: "Edge", browserMajor: 131, os: "Windows" },
  },
  {
    name: "Chrome on Android",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.58 Mobile Safari/537.36",
    expected: { browser: "Chrome", browserMajor: 130, os: "Android" },
  },
  {
    name: "Safari on macOS",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    expected: { browser: "Safari", browserMajor: 18, os: "macOS" },
  },
  {
    name: "Firefox on Linux",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    expected: { browser: "Firefox", browserMajor: 128, os: "Linux" },
  },
  {
    name: "Chrome on iOS",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1",
    expected: { browser: "Chrome", browserMajor: 131, os: "iOS" },
  },
] as const;

describe("parseUserAgent", () => {
  for (const { name, userAgent, expected } of REAL_USER_AGENTS) {
    test(name, () => {
      expect(parseUserAgent(userAgent)).toEqual(expected);
    });
  }

  test("an unrecognizable user agent yields no device", () => {
    expect(parseUserAgent("curl/8.7.1")).toBeNull();
  });

  test("a missing user agent yields no device", () => {
    expect(parseUserAgent(null)).toBeNull();
    expect(parseUserAgent("")).toBeNull();
  });
});
