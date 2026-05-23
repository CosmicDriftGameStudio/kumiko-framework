import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { RendererError, type RenderRequest, type RenderResponse } from "../renderer-foundation";
import { simpleRenderer } from "./simple-renderer";

// Adapter: simpleRenderer.render hat `Promise<string>`-Signatur (Legacy
// NotificationRenderer-Contract), renderer-foundation erwartet
// `Promise<RenderResponse>` mit discriminated union. Mapper bewahrt
// die simpleRenderer-Implementierung (Template-Strings → HTML mit
// Inline-CSS) und packt sie in den RendererPlugin-Contract.
//
// Exported damit der Adapter-Pfad direkt testbar ist (unit-test).
export async function adaptToFoundation(req: RenderRequest): Promise<RenderResponse> {
  if (req.kind !== "notification") {
    // Defensiver Guard — Foundation wählt Plugins nur für matching kinds,
    // dieser Pfad sollte unter normalen Umständen nie erreicht werden.
    throw new RendererError(
      `renderer-simple supports only kind="notification", got "${req.kind}"`,
      "invalid_payload",
    );
  }
  const html = await simpleRenderer.render({
    template: req.payload.template ?? "",
    variables: req.payload.variables ?? {},
  });
  return { kind: "notification", html };
}

export function createRendererSimpleFeature(): FeatureDefinition {
  return defineFeature("renderer-simple", (r) => {
    r.requires("renderer-foundation");

    r.useExtension("renderer", "simple", {
      kinds: ["notification"] as const,
      render: adaptToFoundation,
    });
  });
}
