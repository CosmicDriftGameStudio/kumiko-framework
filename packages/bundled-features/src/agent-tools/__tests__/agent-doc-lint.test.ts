import { describe, expect, test } from "bun:test";
import {
  defineFeature,
  defineWriteHandler,
  resolveAgentExposure,
  SYSTEM_ONLY_JSON_SCHEMA_KEY,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  AgentDocGapKinds,
  findAgentDocGaps,
  findHandlerTranslationGaps,
  formatAgentDocGap,
} from "../agent-doc-lint.js";

const OPEN_ACCESS = {
  openToAll: { reason: "test handler callable by any signed-in test user" },
} as const;

async function noopWriteHandler() {
  return { isSuccess: true as const, data: {} };
}

async function noopQueryHandler() {
  return {};
}

describe("findAgentDocGaps", () => {
  test("exposed handler with a schema that has no JSON Schema form -> schema gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({ at: z.instanceof(Date) }), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Does A.",
      });
    });

    const gaps = findAgentDocGaps([feature]);

    expect(gaps.map((g) => [g.qn, g.kind])).toEqual([
      ["doc-gap-demo:write:do-a", AgentDocGapKinds.handlerSchemaNotExpressible],
    ]);
  });

  test("R1: exactly three undescribed handlers -> exactly three gaps with the expected QNs", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, { access: OPEN_ACCESS });
      r.writeHandler("do-b", z.object({}), noopWriteHandler, { access: OPEN_ACCESS });
      r.queryHandler("get-c", z.object({}), noopQueryHandler, { access: OPEN_ACCESS });
    });

    const gaps = findAgentDocGaps([feature]);

    expect(gaps).toHaveLength(3);
    expect(gaps.map((g) => g.qn)).toEqual([
      "doc-gap-demo:query:get-c",
      "doc-gap-demo:write:do-a",
      "doc-gap-demo:write:do-b",
    ]);
  });

  test("R1: handler exposed via agent.expose:true without description -> exposed-without-description gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        agent: { expose: true },
      });
    });

    const gaps = findAgentDocGaps([feature]);

    expect(gaps.map((g) => [g.qn, g.kind])).toEqual([
      ["doc-gap-demo:write:do-a", AgentDocGapKinds.handlerWithoutDescription],
    ]);
    expect(gaps[0]?.message).toContain("is exposed to the AI agent");
    expect(gaps[0]?.message).not.toContain("stays invisible");
  });

  test("R1: blank description -> gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "   ",
      });
    });

    expect(findAgentDocGaps([feature]).map((g) => g.qn)).toEqual(["doc-gap-demo:write:do-a"]);
  });

  test("R1: handler with description -> no gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Does A.",
      });
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  test("R1: handler with agent.expose:false opt-out -> no gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        agent: { expose: false },
      });
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  // defineWriteHandler rebuilds its return value from an explicit field
  // whitelist, so a slot it forgets to copy is invisible here even though the
  // author wrote it — that regression hid 37 bundled descriptions.
  test("R1: description authored through defineWriteHandler survives the def rebuild", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler(
        defineWriteHandler({
          name: "do-a",
          schema: z.object({}),
          access: OPEN_ACCESS,
          description: "Does A.",
          handler: noopWriteHandler,
        }),
      );
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  test("R1: agent hints authored through defineWriteHandler reach the resolved exposure", () => {
    const optedOut = defineWriteHandler({
      name: "do-internal",
      schema: z.object({}),
      access: OPEN_ACCESS,
      agent: { expose: false },
      handler: noopWriteHandler,
    });
    const destructive = defineWriteHandler({
      name: "do-destroy",
      schema: z.object({}),
      access: OPEN_ACCESS,
      description: "Destroys the thing.",
      agent: { risk: "high" },
      handler: noopWriteHandler,
    });

    expect(resolveAgentExposure(optedOut, "write").expose).toBe(false);
    expect(resolveAgentExposure(destructive, "write").risk).toBe("high");
    expect(
      findAgentDocGaps([
        defineFeature("doc-gap-demo", (r) => {
          r.writeHandler(optedOut);
          r.writeHandler(destructive);
        }),
      ]),
    ).toHaveLength(0);
  });

  test("R2: custom screen without description -> exactly one gap with the correct QN", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.screen({ id: "widget-editor", type: "custom", renderer: { react: "stub" } });
    });

    const gaps = findAgentDocGaps([feature]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.qn).toBe("doc-gap-demo:screen:widget-editor");
  });

  test("R2: custom screen WITH description -> no gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.screen({
        id: "widget-editor",
        type: "custom",
        renderer: { react: "stub" },
        description: "Edits a widget.",
      });
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  test("R2: custom screen with agent.expose:false opt-out -> no gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.screen({
        id: "sysadmin-secrets",
        type: "custom",
        renderer: { react: "stub" },
        agent: { expose: false },
      });
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  test("R2: custom screen with agent.expose:true but no description -> still a gap", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.screen({
        id: "widget-editor",
        type: "custom",
        renderer: { react: "stub" },
        agent: { expose: true },
      });
    });

    const gaps = findAgentDocGaps([feature]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.qn).toBe("doc-gap-demo:screen:widget-editor");
    expect(gaps[0]?.kind).toBe(AgentDocGapKinds.customScreenWithoutDescription);
  });

  test("R2: the custom-screen gap message names both ways out", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.screen({ id: "widget-editor", type: "custom", renderer: { react: "stub" } });
    });

    const gaps = findAgentDocGaps([feature]);
    expect(gaps).toHaveLength(1);
    expect(formatAgentDocGap(gaps[0]!)).toContain("agent: { expose: false }");
    expect(formatAgentDocGap(gaps[0]!)).toContain("`description`");
  });

  test("R2: non-custom screen without description -> no gap (only custom screens are linted)", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.entity("widget", { fields: {}, description: "A widget." });
      r.screen({ id: "widget-list", type: "entityList", entity: "widget", columns: [] });
    });

    expect(findAgentDocGaps([feature])).toHaveLength(0);
  });

  test("R3: entity without description with two agent-visible handlers -> exactly one gap", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: {} });
      r.writeHandler("widget:create", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Creates a widget.",
      });
      r.writeHandler("widget:update", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Updates a widget.",
      });
    });

    const gaps = findAgentDocGaps([feature]);
    const entityGaps = gaps.filter((g) => g.qn === "widgets:entity:widget");
    expect(entityGaps).toHaveLength(1);
  });

  test("R3: entity WITH description -> no entity gap", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: {}, description: "A widget." });
      r.writeHandler("widget:create", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Creates a widget.",
      });
    });

    expect(findAgentDocGaps([feature]).some((g) => g.qn === "widgets:entity:widget")).toBe(false);
  });

  test("R3: entity whose only mapped handler opts out via agent.expose:false -> no entity gap", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: {} });
      r.writeHandler("widget:create", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        agent: { expose: false },
      });
    });

    expect(findAgentDocGaps([feature]).some((g) => g.qn === "widgets:entity:widget")).toBe(false);
  });

  test("R3: fires for an agent-visible QUERY handler too (handlerEntityMappings can't distinguish namespaces)", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: {} });
      r.queryHandler("widget:list", z.object({}), noopQueryHandler, {
        access: OPEN_ACCESS,
        description: "Lists widgets.",
      });
    });

    const gaps = findAgentDocGaps([feature]);
    expect(gaps.filter((g) => g.qn === "widgets:entity:widget")).toHaveLength(1);
  });

  test("R3: camelCase entity name -> qn keeps the raw name, not kebab-cased", () => {
    const feature = defineFeature("document-ingest", (r) => {
      r.entity("documentExtract", { fields: {} });
      r.writeHandler("documentExtract:create", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Creates a document extract.",
      });
    });

    const gaps = findAgentDocGaps([feature]);
    const entityGaps = gaps.filter(
      (g) => g.kind === AgentDocGapKinds.exposedEntityWithoutDescription,
    );
    expect(entityGaps).toHaveLength(1);
    expect(entityGaps[0]?.qn).toBe("document-ingest:entity:documentExtract");
  });

  test("clean registry (everything described) -> empty array", () => {
    const feature = defineFeature("widgets", (r) => {
      r.entity("widget", { fields: {}, description: "A widget." });
      r.writeHandler("widget:create", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Creates a widget.",
      });
      r.screen({
        id: "widget-editor",
        type: "custom",
        renderer: { react: "stub" },
        description: "Edits a widget.",
      });
    });

    expect(findAgentDocGaps([feature])).toEqual([]);
  });

  test("result is sorted by qn", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.queryHandler("get-z", z.object({}), noopQueryHandler, { access: OPEN_ACCESS });
      r.writeHandler("do-a", z.object({}), noopWriteHandler, { access: OPEN_ACCESS });
      r.screen({ id: "widget-editor", type: "custom", renderer: { react: "stub" } });
    });

    const qns = findAgentDocGaps([feature]).map((g) => g.qn);
    expect(qns).toEqual([...qns].sort());
  });

  test("formatAgentDocGap includes the qn and the reason", () => {
    const feature = defineFeature("doc-gap-demo", (r) => {
      r.writeHandler("do-a", z.object({}), noopWriteHandler, { access: OPEN_ACCESS });
    });

    const [gap] = findAgentDocGaps([feature]);
    expect(gap).toBeDefined();
    const formatted = formatAgentDocGap(gap as NonNullable<typeof gap>);
    expect(formatted).toContain((gap as NonNullable<typeof gap>).qn);
    expect(formatted).toContain((gap as NonNullable<typeof gap>).message);
  });
});

describe("findAgentDocGaps — handler-without-translation", () => {
  function translationGaps(features: Parameters<typeof findAgentDocGaps>[0]) {
    return findHandlerTranslationGaps(features);
  }

  function exposedHandlerFeature(
    translations: Record<string, { readonly en: string }>,
    extra?: (r: Parameters<Parameters<typeof defineFeature>[1]>[0]) => void,
  ) {
    return defineFeature("tr-demo", (r) => {
      r.writeHandler("do-x", z.object({ vehicleId: z.string() }), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Does X.",
      });
      if (Object.keys(translations).length > 0) r.translations({ keys: translations });
      extra?.(r);
    });
  }

  test("exposed write handler without entity or keys -> one warning gap listing the missing keys", () => {
    const gaps = translationGaps([exposedHandlerFeature({})]);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.qn).toBe("tr-demo:write:do-x");
    expect(gaps[0]?.message).toContain("tr-demo:write:do-x:title");
    expect(gaps[0]?.message).toContain("tr-demo:write:do-x:field:vehicleId");
    expect(gaps[0]?.kind).toBe(AgentDocGapKinds.handlerWithoutTranslation);
  });

  test("findAgentDocGaps never reports translation gaps (agent-manifest guard contract)", () => {
    const gaps = findAgentDocGaps([exposedHandlerFeature({})]);
    expect(gaps.some((g) => g.kind === AgentDocGapKinds.handlerWithoutTranslation)).toBe(false);
  });

  test("fully spelled-out keys for title and all fields -> no gap", () => {
    const gaps = translationGaps([
      exposedHandlerFeature({
        "tr-demo:write:do-x:title": { en: "Do X" },
        "tr-demo:write:do-x:field:vehicleId": { en: "Vehicle" },
      }),
    ]);
    expect(gaps).toEqual([]);
  });

  test("only a missing field label is reported", () => {
    const gaps = translationGaps([
      exposedHandlerFeature({ "tr-demo:write:do-x:title": { en: "Do X" } }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.message).not.toContain("do-x:title");
    expect(gaps[0]?.message).toContain("do-x:field:vehicleId");
  });

  test("a local (unprefixed) key does not count because the client resolves keys verbatim", () => {
    const gaps = translationGaps([
      exposedHandlerFeature({
        "write:do-x:title": { en: "Do X" },
        "write:do-x:field:vehicleId": { en: "Vehicle" },
      }),
    ]);
    expect(gaps).toHaveLength(1);
  });

  test("system-only input fields need no label", () => {
    const feature = defineFeature("tr-demo", (r) => {
      r.writeHandler(
        "do-x",
        z.object({ tenantIdOverride: z.string().meta({ [SYSTEM_ONLY_JSON_SCHEMA_KEY]: true }) }),
        noopWriteHandler,
        { access: OPEN_ACCESS, description: "Does X." },
      );
      r.translations({ keys: { "tr-demo:write:do-x:title": { en: "Do X" } } });
    });
    expect(translationGaps([feature])).toEqual([]);
  });

  test("handler mapped to an entity -> no gap", () => {
    const feature = defineFeature("tr-demo", (r) => {
      r.entity("vehicle", { fields: { name: { type: "text", required: true } } });
      r.writeHandler("vehicle:do-x", z.object({}), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Does X.",
      });
    });
    expect(feature.handlerEntityMappings?.["vehicle:do-x"]).toBeDefined();
    expect(translationGaps([feature])).toEqual([]);
  });

  test("handler used by an actionForm screen -> no gap", () => {
    const feature = exposedHandlerFeature({}, (r) => {
      r.screen({
        id: "do-x-form",
        type: "actionForm",
        handler: "tr-demo:write:do-x",
        fields: {} as never,
        layout: { sections: [] } as never,
      });
    });
    expect(translationGaps([feature])).toEqual([]);
  });

  test("handler not exposed to the agent -> no gap", () => {
    const feature = defineFeature("tr-demo", (r) => {
      r.writeHandler("do-x", z.object({ a: z.string() }), noopWriteHandler, {
        access: OPEN_ACCESS,
        description: "Does X.",
        agent: { expose: false },
      });
    });
    expect(translationGaps([feature])).toEqual([]);
  });
});
