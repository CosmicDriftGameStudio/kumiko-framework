import { beforeAll, describe, expect, test } from "bun:test";
import { registerMailTranslations } from "@cosmicdrift/kumiko-framework/i18n";
import { dispatchMagicLinkMail } from "../magic-link-mail";

describe("dispatchMagicLinkMail appUrl locale negotiation", () => {
  beforeAll(() => {
    registerMailTranslations("de", { "test.unused": "x" });
  });

  test("negotiates de-AT down to de for language-in-path appUrl", async () => {
    const seen: string[] = [];
    await dispatchMagicLinkMail(
      async () => {},
      {
        handlerName: "test",
        notificationType: "test.mail",
        renderContent: (args) => {
          seen.push(args.url);
          return {
            subject: "s",
            header: "h",
            sections: [],
            footer: "f",
          };
        },
      },
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
});
