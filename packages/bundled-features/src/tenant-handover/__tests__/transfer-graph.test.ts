// Adjacency resolution alone (kumiko-framework#3088, #3131) — the traversal
// and its depth limit live in the mover now and are covered end-to-end in
// claim.integration.test.ts. What matters here is that every declared edge is
// reported against the right parent type, and that the shapes the mover must
// never see are filtered out.

import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  type EntityDefinition,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveTransferAdjacency, type TransferAdjacency } from "../transfer-graph";

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

function childrenOf(adjacency: TransferAdjacency, parentEntityName: string): string[] {
  return (adjacency.get(parentEntityName) ?? []).map((edge) => edge.entityName).sort();
}

describe("resolveTransferAdjacency", () => {
  // Adjacency is depth-free on purpose: `channelText` hangs off `campaign`
  // whether the mover reaches `campaign` in the first round or the third. That
  // is what lets a type reached by two paths of different length still have its
  // descendants walked (#3131).
  test("keys each edge by the type it hangs off, not by its distance from the root", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
        channelText: entity({ references: { campaignId: "campaign" } }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual(["campaign"]);
    expect(childrenOf(adjacency, "campaign")).toEqual(["channelText"]);
  });

  test("reports parentRef edges against every type the parentRef accepts", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
        photo: entity({ parentRefTo: ["run", "campaign"] }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual(["campaign", "photo"]);
    expect(childrenOf(adjacency, "campaign")).toEqual(["photo"]);
  });

  // Collapsing these by entity name would leave one edge's rows behind, which
  // is the silent partial move #3088 exists to end.
  test("keeps both edges when one entity points at two types in the graph", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "run" } }),
        note: entity({ references: { runId: "run", campaignId: "campaign" } }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual(["campaign", "note"]);
    expect(childrenOf(adjacency, "campaign")).toEqual(["note"]);
  });

  test("keeps both edges when one entity points at the same type through two fields", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        note: entity({ references: { runId: "run", otherRunId: "run" } }),
      }),
      "run",
    );

    const fields = (adjacency.get("run") ?? []).map((edge) =>
      edge.link.kind === "reference" ? edge.link.field : edge.link.idField,
    );
    expect(fields.sort()).toEqual(["otherRunId", "runId"]);
  });

  // Without this the mover would drag unrelated rows of the root's own type
  // across the tenant boundary along with the one that was actually claimed.
  test("never reports the root as someone else's child, even on a self reference", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({ run: entity({ references: { parentRunId: "run" } }) }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual([]);
  });

  // A cycle is no longer the resolver's problem: it reports the edges, and the
  // mover terminates because an already-moved row stops matching the source
  // tenant. Adjacency just has to describe the cycle faithfully.
  test("reports both directions of a reference cycle", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        a: entity({ references: { runId: "run", bId: "b" } }),
        b: entity({ references: { aId: "a" } }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "a")).toEqual(["b"]);
    expect(childrenOf(adjacency, "b")).toEqual(["a"]);
  });

  // `transferable` is enforced by the mover against candidates that turn out
  // to have rows — the resolver stays broad on purpose (see its header).
  test("reports a non-transferable child so the mover can reject it by name", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        note: entity({ references: { runId: "run" }, transferable: false }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual(["note"]);
  });

  // "<feature>:<entity>" is a legal ReferenceFieldDef.entity form for
  // cross-feature refs (engine/parse-ref-target.ts) — an edge must resolve
  // by entity name regardless of which feature's prefix the declaration used.
  test("resolves a feature-prefixed reference target to the same edge", () => {
    const adjacency = resolveTransferAdjacency(
      registryOf({
        run: entity({}),
        campaign: entity({ references: { runId: "vehicles:run" } }),
      }),
      "run",
    );

    expect(childrenOf(adjacency, "run")).toEqual(["campaign"]);
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
    const adjacency = resolveTransferAdjacency(registryOf({ run: entity({}), bulk }), "run");

    expect(childrenOf(adjacency, "run")).toEqual([]);
  });
});
