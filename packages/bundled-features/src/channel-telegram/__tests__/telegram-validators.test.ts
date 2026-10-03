import { describe, expect, test } from "bun:test";
import {
  createTelegramChannel,
  isTelegramBotToken,
  isTelegramChatId,
} from "../telegram-channel.js";

describe("isTelegramChatId", () => {
  test.each(["123", "-1001234567890", "@ops_channel"])("accepts %s", (address) => {
    expect(isTelegramChatId(address)).toBe(true);
  });

  test.each(["", "12/../34", "@ab", "@1channel", "1 2", "ops"])("rejects %s", (address) => {
    expect(isTelegramChatId(address)).toBe(false);
  });
});

describe("isTelegramBotToken", () => {
  test("accepts <bot id>:<secret>", () => {
    expect(isTelegramBotToken("123456:ABCdef_ghi-JKLmno")).toBe(true);
  });

  test.each(["", "123456", "abc:ABCdef_ghi-JKLmno", "123456:short", "123456:has space1234567"])(
    "rejects %s",
    (token) => {
      expect(isTelegramBotToken(token)).toBe(false);
    },
  );
});

describe("createTelegramChannel boot validation", () => {
  test("rejects an apiBaseUrl host outside allowedHosts", () => {
    expect(() => createTelegramChannel({ apiBaseUrl: "https://evil.example" }, "k")).toThrow(
      /not in allowedHosts/,
    );
  });

  test("rejects http without requireHttps opt-out", () => {
    expect(() =>
      createTelegramChannel({ apiBaseUrl: "http://127.0.0.1:1", allowedHosts: ["127.0.0.1"] }, "k"),
    ).toThrow(/https/);
  });

  test("accepts default and explicit opt-out configs", () => {
    expect(() => createTelegramChannel({}, "k")).not.toThrow();
    expect(() =>
      createTelegramChannel(
        { apiBaseUrl: "http://127.0.0.1:1", allowedHosts: ["127.0.0.1"], requireHttps: false },
        "k",
      ),
    ).not.toThrow();
  });
});
