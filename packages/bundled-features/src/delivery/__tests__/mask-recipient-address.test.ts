import { describe, expect, test } from "bun:test";
import { PII_CIPHERTEXT_PREFIX } from "@cosmicdrift/kumiko-framework/crypto";
import { maskRecipientAddress } from "../mask-recipient-address.js";

describe("maskRecipientAddress", () => {
  test("null stays null", () => {
    expect(maskRecipientAddress(null)).toBeNull();
  });

  test("PII ciphertext is fully masked", () => {
    expect(maskRecipientAddress(`${PII_CIPHERTEXT_PREFIX}c29tZS1jaXBoZXJ0ZXh0`)).toBe("***");
  });

  test("an email keeps the first character of the local part and the domain", () => {
    expect(maskRecipientAddress("jane.doe@example.com")).toBe("j***@example.com");
  });

  test("an http(s) URL keeps only the origin", () => {
    expect(maskRecipientAddress("https://hooks.slack.com/services/T000/B000/secret")).toBe(
      "https://hooks.slack.com/***",
    );
    expect(maskRecipientAddress("http://localhost:8080/hook?token=abc")).toBe(
      "http://localhost:8080/***",
    );
  });

  test("a URL containing an @ is masked as a URL, not as an email", () => {
    expect(maskRecipientAddress("https://example.webhook.office.com/webhookb2/a@b/secret")).toBe(
      "https://example.webhook.office.com/***",
    );
  });

  test("other values of 8+ characters keep the last 4", () => {
    expect(maskRecipientAddress("123456789012")).toBe("***9012");
  });

  test("short other values are fully masked", () => {
    expect(maskRecipientAddress("1234567")).toBe("***");
  });

  test("a value with several @ or an empty local part is not treated as an email", () => {
    expect(maskRecipientAddress("a@b@example.com")).toBe("***.com");
    expect(maskRecipientAddress("@example.com")).toBe("***.com");
  });
});
