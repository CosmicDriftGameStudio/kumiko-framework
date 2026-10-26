import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import type { DashboardScreenDefinition } from "../types/screen.ts";

const OPEN_ACCESS = { openToAll: { reason: "test handler callable by any signed-in test user" } };

function featureEmbeddingDetail(
  dashboard: Pick<DashboardScreenDefinition, "record">,
  panel: { readonly screen: string; readonly fallback?: string },
) {
  return defineFeature("demo", (r) => {
    r.queryHandler({
      name: "site:detail",
      schema: z.object({ id: z.string() }),
      handler: async () => ({ name: "Main" }),
      access: OPEN_ACCESS,
    });
    r.queryHandler({
      name: "site:status",
      schema: z.object({}),
      handler: async () => ({ enabled: true }),
      access: OPEN_ACCESS,
    });
    r.screen({
      id: "site-detail",
      type: "projectionDetail",
      query: "demo:query:site:detail",
      layout: { sections: [{ title: "demo:site:title", fields: ["name"] }] },
    } as never);
    r.screen({
      id: "site-hint",
      type: "projectionDetail",
      query: "demo:query:site:detail",
      layout: { sections: [{ title: "demo:site:title", fields: ["name"] }] },
    } as never);
    r.screen({
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "screen",
          id: "site",
          screen: panel.screen,
          ...(panel.fallback !== undefined && {
            visibleWhen: { query: "demo:query:site:status", field: "enabled", eq: true },
            fallback: panel.fallback,
          }),
        },
      ],
      ...dashboard,
    });
    r.translations({
      keys: {
        "screen:site-detail.title": { de: "Standort", en: "Site" },
        "screen:site-hint.title": { de: "Hinweis", en: "Hint" },
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "demo:site:title": { de: "Standort", en: "Site" },
        "demo:entity:__projection-detail__:field:name": { de: "Name", en: "Name" },
      },
    });
  });
}

describe("validateBoot — projectionDetail embedded in a dashboard panel", () => {
  test("accepts a projectionDetail panel on a dashboard with a record binding", () => {
    const feature = featureEmbeddingDetail({ record: { param: "id" } }, { screen: "site-detail" });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("accepts a projectionDetail fallback on a dashboard with a record binding", () => {
    const feature = featureEmbeddingDetail(
      { record: { param: "id" } },
      { screen: "site-detail", fallback: "site-hint" },
    );
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects a projectionDetail panel on a dashboard without a record binding", () => {
    const feature = featureEmbeddingDetail({}, { screen: "site-detail" });
    expect(() => validateBoot([feature])).toThrow(
      /embeds "demo:screen:site-detail", a projectionDetail, but the host dashboard has no record binding/,
    );
  });
});
