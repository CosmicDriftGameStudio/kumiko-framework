import { beforeAll, describe, expect, test } from "bun:test";
import { localeEs } from "@cosmicdrift/kumiko-locale-es";
import { DELIVERY_RESUBSCRIBE_PATH } from "../public-names.ts";
import { renderUnsubscribeResultPage } from "../unsubscribe.ts";

beforeAll(() => {
  localeEs();
});

describe("renderUnsubscribeResultPage", () => {
  test("unsubscribed with a token offers the undo form, escaped", () => {
    const html = renderUnsubscribeResultPage({
      kind: "unsubscribed",
      resubscribeToken: 'tok"en',
      locale: "en",
    });
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Unsubscribed</title>");
    expect(html).toContain(`action="${DELIVERY_RESUBSCRIBE_PATH}"`);
    expect(html).toContain('value="tok&quot;en"');
  });

  test("unsubscribed without a token has no undo form", () => {
    const html = renderUnsubscribeResultPage({ kind: "unsubscribed", locale: "en" });
    expect(html).not.toContain("<form");
  });

  test("speaks the requested locale when its mail translations are registered", () => {
    const html = renderUnsubscribeResultPage({ kind: "unsubscribed", locale: "es" });
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>Baja confirmada</title>");
    expect(html).toContain("Ya no recibirás estos correos.");
  });

  test("resubscribed and failed pages", () => {
    expect(renderUnsubscribeResultPage({ kind: "resubscribed", locale: "es" })).toContain(
      "Suscripción restablecida",
    );
    expect(renderUnsubscribeResultPage({ kind: "failed" })).toContain('<html lang="en">');
  });

  test("an app's own dead link gets the link-invalid page without a form", () => {
    const html = renderUnsubscribeResultPage({ kind: "invalid", locale: "es" });
    expect(html).toContain("<title>Enlace no válido</title>");
    expect(html).not.toContain("<form");
  });
});
