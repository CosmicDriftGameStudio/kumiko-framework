import { describe, expect, test } from "vitest";
import { RendererError } from "../../renderer-foundation";
import { adaptToFoundation } from "../feature";

describe("renderer-simple :: adaptToFoundation", () => {
  test("kind='notification' rendert via simpleRenderer und gibt RenderResponse zurück", async () => {
    const res = await adaptToFoundation({
      kind: "notification",
      payload: {
        template: "welcome",
        variables: { title: "Welcome!", body: "Hello there" },
      },
    });
    expect(res.kind).toBe("notification");
    if (res.kind === "notification") {
      // simpleRenderer baut HTML mit title als header + body als section
      expect(res.html).toContain("Welcome!");
      expect(res.html).toContain("Hello there");
      expect(res.html).toContain("<!DOCTYPE html>");
    }
  });

  test("leere variables → leerer body, kein crash", async () => {
    const res = await adaptToFoundation({
      kind: "notification",
      payload: { template: "", variables: {} },
    });
    expect(res.kind).toBe("notification");
  });

  test("non-notification kind → RendererError mit code 'invalid_payload'", async () => {
    await expect(
      adaptToFoundation({
        kind: "mail-html",
        payload: { content: "test", contentFormat: "markdown" },
      }),
    ).rejects.toThrow(RendererError);

    try {
      await adaptToFoundation({
        kind: "document-pdf",
        payload: { content: "test", contentFormat: "markdown" },
      });
      expect.fail("expected RendererError");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("invalid_payload");
    }
  });
});
