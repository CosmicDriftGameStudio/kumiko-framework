import { describe, expect, test } from "bun:test";
import { isTelegramBotToken, isTelegramChatId } from "../telegram-channel.js";

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
