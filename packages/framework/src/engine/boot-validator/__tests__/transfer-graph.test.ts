// fw#3088 — boot guard for the tenant-handover transfer graph. Both shapes
// checked here would otherwise leave rows behind in the source tenant at
// handover time, which is the silent partial move the issue exists to end.
// Scoped to `transferable: true`, so a consumer that has the shape but never
// hands the entity over keeps booting.

import { describe, expect, test } from "bun:test";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import type { EntityDefinition, FeatureDefinition } from "../../types";
import { MAX_TRANSFER_DEPTH, validateTransferGraph } from "../transfer-graph";

const textField = () => createTextField({ personal: false, reason: "technical_reference" });

function entity(opts: {
  readonly references?: Readonly<Record<string, { entity: string; multiple?: true }>>;
  readonly transferable?: boolean;
}): EntityDefinition {
  const references = Object.fromEntries(
    Object.entries(opts.references ?? {}).map(([field, ref]) => [
      field,
      { type: "reference" as const, entity: ref.entity, ...(ref.multiple && { multiple: true }) },
    ]),
  );
  return createEntity({
    table: "graph_rows",
    ...(opts.transferable !== false && { transferable: true }),
    fields: { ...references, label: textField() },
  });
}

function validate(entities: Readonly<Record<string, EntityDefinition>>): void {
  const feature = defineFeature("graph", (r) => {
    for (const [name, def] of Object.entries(entities)) r.entity(name, def);
  });
  const featureMap: ReadonlyMap<string, FeatureDefinition> = new Map([[feature.name, feature]]);
  validateTransferGraph(feature, featureMap);
}

describe("validateTransferGraph", () => {
  test("accepts a nested reference chain within the depth limit", () => {
    expect(() =>
      validate({
        run: entity({}),
        campaign: entity({ references: { runId: { entity: "run" } } }),
        channelText: entity({ references: { campaignId: { entity: "campaign" } } }),
      }),
    ).not.toThrow();
  });

  test("rejects a multiple reference on a transferable entity", () => {
    expect(() =>
      validate({
        run: entity({}),
        bulk: entity({ references: { runIds: { entity: "run", multiple: true } } }),
      }),
    ).toThrow(/multiple reference field "runIds"/);
  });

  // The narrow scope is the point: boot-rejecting every multiple reference
  // would break consumers who never hand that entity over.
  test("leaves a multiple reference alone when the entity is not transferable", () => {
    expect(() =>
      validate({
        run: entity({}),
        bulk: entity({
          references: { runIds: { entity: "run", multiple: true } },
          transferable: false,
        }),
      }),
    ).not.toThrow();
  });

  // The boundary the mover actually draws: it runs MAX_TRANSFER_DEPTH rounds of
  // one hop each, so 5 edges (6 entities) still move as one graph and the
  // validator must not reject them. Off by one here and a supported schema
  // stops booting.
  test("accepts a chain of exactly the maximum depth", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= MAX_TRANSFER_DEPTH; i++) {
      chain[`e${i}`] = entity({ references: { parentId: { entity: `e${i - 1}` } } });
    }

    expect(() => validate(chain)).not.toThrow();
  });

  test("rejects a chain one edge past the limit and names the path", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= MAX_TRANSFER_DEPTH + 1; i++) {
      chain[`e${i}`] = entity({ references: { parentId: { entity: `e${i - 1}` } } });
    }

    expect(() => validate(chain)).toThrow(/deeper than the 5-level limit.*e0 -> e1/s);
  });

  test("rejects a chain far deeper than the limit and names the path", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= 7; i++) {
      chain[`e${i}`] = entity({ references: { parentId: { entity: `e${i - 1}` } } });
    }

    expect(() => validate(chain)).toThrow(/deeper than the 5-level limit.*e0 -> e1/s);
  });

  test("does not count a non-transferable link as part of the chain", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= 7; i++) {
      chain[`e${i}`] = entity({
        references: { parentId: { entity: `e${i - 1}` } },
        // Breaks the chain in the middle: the walk stops here.
        ...(i === 3 && { transferable: false }),
      });
    }

    expect(() => validate(chain)).not.toThrow();
  });

  // A feature-prefixed reference target ("<feature>:<entity>") must resolve
  // to the same entity name as an unprefixed one, or a chain built entirely
  // out of prefixed refs would silently never trip the depth limit.
  test("counts a chain of feature-prefixed reference targets into the depth limit", () => {
    const chain: Record<string, EntityDefinition> = { e0: entity({}) };
    for (let i = 1; i <= MAX_TRANSFER_DEPTH + 1; i++) {
      chain[`e${i}`] = entity({ references: { parentId: { entity: `graph:e${i - 1}` } } });
    }

    expect(() => validate(chain)).toThrow(/deeper than the 5-level limit.*e0 -> e1/s);
  });

  test("terminates on a reference cycle instead of reporting false depth", () => {
    expect(() =>
      validate({
        a: entity({ references: { bId: { entity: "b" } } }),
        b: entity({ references: { aId: { entity: "a" } } }),
      }),
    ).not.toThrow();
  });
});
