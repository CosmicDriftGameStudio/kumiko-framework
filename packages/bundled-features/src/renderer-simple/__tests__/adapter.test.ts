import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { type RendererContext, RendererError } from "../../renderer-foundation";
import { adaptToFoundation } from "../feature";

const STUB_CTX: RendererContext = {
  db: null as never,
  registry: null as never,
  tenantId: "11111111-1111-4111-8111-111111111111" as TenantId,
};

describe("renderer-simple :: adaptToFoundation", () => {
  test("kind='notification' rendert via simpleRenderer und gibt RenderResponse zurück", async () => {
    const res = await adaptToFoundation(
      {
        kind: "notification",
        payload: {
          template: "welcome",
          variables: { title: "Welcome!", body: "Hello there" },
        },
      },
      STUB_CTX,
    );
    expect(res.kind).toBe("notification");
    if (res.kind === "notification") {
      // simpleRenderer baut HTML mit title als header + body als section
      expect(res.html).toContain("Welcome!");
      expect(res.html).toContain("Hello there");
      expect(res.html).toContain("<!DOCTYPE html>");
    }
  });

  test("leere variables → leerer body, kein crash", async () => {
    const res = await adaptToFoundation(
      {
        kind: "notification",
        payload: { template: "", variables: {} },
      },
      STUB_CTX,
    );
    expect(res.kind).toBe("notification");
  });

  test("non-notification kind → RendererError mit code 'invalid_payload'", async () => {
    await expect(
      adaptToFoundation(
        {
          kind: "mail-html",
          payload: { content: "test", contentFormat: "markdown" },
        },
        STUB_CTX,
      ),
    ).rejects.toThrow(RendererError);

    try {
      await adaptToFoundation(
        {
          kind: "document-pdf",
          payload: { content: "test", contentFormat: "markdown" },
        },
        STUB_CTX,
      );
      throw new Error("expected RendererError");
    } catch (e) {
      expect(e).toBeInstanceOf(RendererError);
      expect((e as RendererError).code).toBe("invalid_payload");
    }
  });
});
