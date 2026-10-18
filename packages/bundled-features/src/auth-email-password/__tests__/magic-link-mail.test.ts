import { beforeAll, describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { dispatchMagicLinkMail } from "../magic-link-mail.ts";

describe("dispatchMagicLinkMail appUrl locale negotiation", () => {
  beforeAll(() => {
    registerMailTranslations("de", { "test.unused": "x" });
  });

  test("negotiates de-AT down to de for language-in-path appUrl", async () => {
    const seen: string[] = [];
    await dispatchMagicLinkMail(
      async (_type, options) => {
        const actionUrl = options.data?.["actionUrl"];
        if (typeof actionUrl === "string") seen.push(actionUrl);
        return { kind: "dispatched", deliveries: [] };
      },
      { handlerName: "test", notificationType: "test.mail" },
      {
        email: "a@example.com",
        appUrl: (locale) => `https://app.example.com/${locale}/activate`,
        token: "tok",
        expiresAt: "2099-01-01T00:00:00Z",
        locale: "de-AT",
      },
    );
    expect(seen[0]).toContain("https://app.example.com/de/activate");
    expect(seen[0]).not.toContain("/de-AT/");
  });

  test("formats expiry in the template locale when the requested locale has no subject key", async () => {
    async function capture(locale: string) {
      let seen:
        | { data: Record<string, unknown> | undefined; locale: string | undefined }
        | undefined;
      await dispatchMagicLinkMail(
        async (_type, options) => {
          seen = { data: options.data, locale: options.locale };
          return { kind: "dispatched", deliveries: [] };
        },
        { handlerName: "test", notificationType: "test.mail" },
        {
          email: "a@example.com",
          appUrl: "https://app.example.com/activate",
          token: "tok",
          issuedAt: "2099-01-01T00:00:00Z",
          expiresAt: "2099-01-01T03:00:00Z",
          locale,
        },
      );
      return seen;
    }

    const requestedFr = await capture("fr");
    const requestedEn = await capture("en");

    expect(requestedFr?.locale).toBe("en");
    expect(requestedFr?.data?.["validFor"]).toBe(requestedEn?.data?.["validFor"]);
    expect(requestedFr?.data?.["validUntil"]).toBe(requestedEn?.data?.["validUntil"]);
  });
});
