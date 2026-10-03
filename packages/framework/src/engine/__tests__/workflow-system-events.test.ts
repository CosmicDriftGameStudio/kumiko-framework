// The kumiko:system:workflow.* events are registered framework events: valid
// projection apply-keys, listed in the feature manifest, PII stance taken from
// the single SYSTEM_EVENT_PII_STANCES map.

import { describe, expect, test } from "bun:test";
import { SYSTEM_EVENT_PII_STANCES } from "../../crypto/system-event-pii.js";
import { defineFeature } from "../define-feature.js";
import { createEntity, createTextField } from "../factories.js";
import { buildManifestFromRegistry } from "../feature-manifest.js";
import { createRegistry } from "../registry.js";
import {
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_RUN_FAILED_TYPE,
  WORKFLOW_RUN_STARTED_TYPE,
} from "../steps/_step-dispatch-constants.js";
import { WORKFLOW_SYSTEM_EVENT_DEFS } from "../steps/workflow-system-events.js";

const noopApply = async (): Promise<void> => {};

function featureApplying(applyKey: string) {
  return defineFeature("test", (r) => {
    r.entity(
      "run-view",
      createEntity({
        table: "run_views",
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
    r.extendEntityProjection("run-view", {
      sources: [WORKFLOW_AGGREGATE_TYPE],
      apply: { [applyKey]: noopApply },
    });
  });
}

describe("registered workflow system events", () => {
  test("extendEntityProjection accepts the workflow event names as apply-keys", () => {
    const registry = createRegistry([featureApplying(WORKFLOW_RUN_FAILED_TYPE)]);
    const projection = registry.getAllProjections().get("test:projection:run-view-entity");
    expect(projection?.apply[WORKFLOW_RUN_FAILED_TYPE]).toBe(noopApply);
    expect(projection?.extraSources).toEqual([WORKFLOW_AGGREGATE_TYPE]);
  });

  test("a typo in a workflow event name still fails boot validation", () => {
    expect(() => createRegistry([featureApplying("kumiko:system:workflow.run-faild")])).toThrow(
      /kumiko:system:workflow\.run-faild/,
    );
  });

  test("registry exposes every workflow event with the declared PII stance", () => {
    const registry = createRegistry([]);
    expect(WORKFLOW_SYSTEM_EVENT_DEFS.size).toBe(7);
    for (const [name, def] of WORKFLOW_SYSTEM_EVENT_DEFS) {
      expect(registry.getEvent(name)?.piiFields).toBe(SYSTEM_EVENT_PII_STANCES.get(name));
      expect(def.version).toBe(1);
    }
  });

  test("run-started schema accepts the trigger reference and the legacy payload copy", () => {
    const schema = WORKFLOW_SYSTEM_EVENT_DEFS.get(WORKFLOW_RUN_STARTED_TYPE)?.schema;
    const base = { workflowName: "w", triggerEventType: "a:event:b", definitionFingerprint: "f" };
    const ref = { eventId: "e", aggregateId: "a", version: 1 };
    expect(schema?.safeParse({ ...base, triggerEventRef: ref }).success).toBe(true);
    expect(schema?.safeParse({ ...base, triggerPayload: { any: "thing" } }).success).toBe(true);
    expect(schema?.safeParse({ workflowName: "w" }).success).toBe(false);
  });

  test("feature manifest lists the workflow events", () => {
    const manifest = buildManifestFromRegistry(createRegistry([]), { source: "test" });
    expect((manifest.systemEvents ?? []).map((event) => event.name)).toEqual(
      [...WORKFLOW_SYSTEM_EVENT_DEFS.keys()].sort(),
    );
    expect((manifest.systemEvents ?? []).every((event) => event.version === 1)).toBe(true);
  });
});
