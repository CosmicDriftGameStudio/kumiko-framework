import { describe, expect, test } from "bun:test";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { clientErrorForRenderFailure } from "../render-and-store";

// The mapping reads only ctx.obs.log; the fallback logger covers an absent one.
const ctx = { obs: {} } as unknown as HandlerContext;

describe("clientErrorForRenderFailure", () => {
  test("payload_too_large → 422 rendered_pdf_too_large with the service limits", () => {
    const error = clientErrorForRenderFailure(
      new RendererError("too big", "payload_too_large", { maxBytes: 100, gotBytes: 200 }),
      ctx,
      "invoice",
    );
    expect(error).toBeInstanceOf(UnprocessableError);
    expect(error.details).toEqual({
      reason: "rendered_pdf_too_large",
      maxBytes: 100,
      gotBytes: 200,
    });
  });

  test("payload_too_large without sizes keeps only the reason", () => {
    const error = clientErrorForRenderFailure(
      new RendererError("too big", "payload_too_large"),
      ctx,
      "invoice",
    );
    expect(error.details).toEqual({ reason: "rendered_pdf_too_large" });
  });
});
