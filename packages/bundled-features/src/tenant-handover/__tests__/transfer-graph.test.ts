// Graph resolution alone (kumiko-framework#3088) — the moving half is covered
// end-to-end in claim.integration.test.ts. What matters here are the shapes
// that are awkward to seed against a real database: a reference cycle, one
// entity reachable by two edges, and the depth limit.

import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  type EntityDefinition,
  MAX_TRANSFER_DEPTH,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveTransferGraph } from "../transfer-graph";

function entity(opts: {
  readonly references?: Readonly<Record<string, string>>;
  readonly parentRefTo?: readonly string[];
  readonly transferable?: boolean;
}): EntityDefinition {
  const references = Object.fromEntries(
    Object.entries(opts.references ?? {}).map(([field, target]) => [
      field,
      { type: "reference" as const, entity: target },
    ]),
  );
  return createEntity({
    table: "t",
    idType: "uuid",
    ...(opts.transferable !== false && { transferable: true }),
    ...(opts.parentRefTo && {
      parentRef: {
        entityTypeField: "hostType",
        entityIdField: "hostId",
        allowedTypes: opts.parentRefTo,
      },
    }),
    fields: {
      ...references,
      ...(opts.parentRefTo && {
        hostType: createTextField({ personal: false, reason: "technical_reference" }),
        hostId: createTextField({ personal: false, reason: "technical_reference" }),
      }),
      label: createTextField({ personal: false, reason: "technical_reference" }),
    },
  });
}

function registryOf(entities: Readonly<Record<string, EntityDefinition>>): Registry {
  const map = new Map(Object.entries(entities));
  return { getAllEntities: () => map } as unknown as Registry;
}

function namesPerLevel(levels: readonly (readonly { entityName: string }[])[]): string[][] {
  return levels.map((level) => level.map((edge) => edge.entityName).sort());
}

describe("resolveTransferGraph", () => {
  test("nests through reference edges, one level per hop", () => {
    const { levels } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
        channelText: entity({ references: { campaignId: "campaign" } }),
      }),
      "run",
    );

    expect(namesPerLevel(levels)).toEqual([["campaign"], ["channelText"]]);
  });

  test("still collects parentRef children, alongside reference ones", () => {
    const { levels } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        photo: entity({ parentRefTo: ["run"] }),
        campaign: entity({ references: { runId: "run" } }),
      }),
      "run",
    );

    expect(namesPerLevel(levels)).toEqual([["campaign", "photo"]]);
  });

  // The reason the resolver de-duplicates by (entity, parent, field) rather
  // than by entity name: dropping the second edge would leave those rows
  // behind, which is the silent partial move #3088 exists to end.
  test("keeps both edges when one entity points at two types in the graph", () => {
    const { levels } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
        note: entity({ references: { runId: "run", campaignId: "campaign" } }),
      }),
      "run",
    );

    const noteEdges = levels.flat().filter((edge) => edge.entityName === "note");
    expect(noteEdges).toHaveLength(2);
    expect(noteEdges.map((e) => e.parentEntityName).sort()).toEqual(["campaign", "run"]);
  });

  test("terminates on a reference cycle instead of looping", () => {
    const { levels } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        a: entity({ references: { runId: "run", bId: "b" } }),
        b: entity({ references: { aId: "a" } }),
      }),
      "run",
    );

    // Every edge appears once; the root is never collected as someone's child.
    const keys = levels.flat().map((e) => `${e.entityName}<-${e.parentEntityName}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("run<-a");
  });

  // Reporting the truncation rather than just stopping is what lets the mover
  // fail loudly instead of leaving the deeper rows behind.
  test("stops at the depth limit and reports the edges it could not reach", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= MAX_TRANSFER_DEPTH + 3; i++) {
      chain[`e${i}`] = entity({ references: { parentId: `e${i - 1}` } });
    }

    const { levels, overflowEdges } = resolveTransferGraph(registryOf(chain), "e0");

    expect(levels).toHaveLength(MAX_TRANSFER_DEPTH);
    expect(overflowEdges.map((edge) => edge.entityName)).toEqual([`e${MAX_TRANSFER_DEPTH + 1}`]);
  });

  test("reports no overflow for a graph that fits inside the limit", () => {
    const { levels, overflowEdges } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
      }),
      "run",
    );

    expect(levels).toHaveLength(1);
    expect(overflowEdges).toEqual([]);
  });

  // `transferable` is enforced by the mover against candidates that turn out
  // to have rows — the resolver stays broad on purpose (see its header).
  test("collects a non-transferable child so the mover can reject it by name", () => {
    const { levels } = resolveTransferGraph(
      registryOf({
        run: entity({}),
        note: entity({ references: { runId: "run" }, transferable: false }),
      }),
      "run",
    );

    expect(namesPerLevel(levels)).toEqual([["note"]]);
  });

  test("ignores a multiple reference, which the boot validator rejects up front", () => {
    const bulk = createEntity({
      table: "t",
      idType: "uuid",
      transferable: true,
      fields: {
        runIds: { type: "reference", entity: "run", multiple: true },
        label: createTextField({ personal: false, reason: "technical_reference" }),
      },
    });

    expect(resolveTransferGraph(registryOf({ run: entity({}), bulk }), "run").levels).toEqual([]);
  });
});
