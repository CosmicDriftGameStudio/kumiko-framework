import { describe, expect, test } from "bun:test";
import {
  defineFeature,
  defineWriteHandler,
  resolveAgentExposure,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { AgentDocGapKinds, findAgentDocGaps, formatAgentDocGap } from "../agent-doc-lint";

const OPEN_ACCESS = { openToAll: true } as const;

async function noopWriteHandler() {
  return { isSuccess: true as const, data: {} };
}

async function noopQueryHandler() {
  return {};
}

describe("findAgentDocGaps", () => {
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
