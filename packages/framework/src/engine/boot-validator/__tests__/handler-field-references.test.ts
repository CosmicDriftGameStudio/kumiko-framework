import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.js";
import { validateBoot } from "../index.js";

const OPEN_ACCESS = { openToAll: { reason: "boot-validator test handler" } } as const;

async function noopHandler() {
  return { isSuccess: true as const, data: {} };
}

function vehicleFeature() {
  return defineFeature("fleet", (r) => {
    r.entity("vehicle", { fields: { name: { type: "text", required: true } } });
  });
}

function consumerFeature(references: string) {
  return defineFeature("planner", (r) => {
    r.writeHandler(
      "plan",
      z.object({ vehicleId: z.string().meta({ references }).optional() }),
      noopHandler,
      {
        access: OPEN_ACCESS,
      },
    );
  });
}

describe("validateBoot — handler field references meta", () => {
  test("rejects a references value naming no registered entity", () => {
    expect(() => validateBoot([vehicleFeature(), consumerFeature("nope")])).toThrow(
      /vehicleId.*references: "nope".*not a registered entity/s,
    );
  });

  test("accepts feature-qualified reference to an existing entity", () => {
    expect(() => validateBoot([vehicleFeature(), consumerFeature("fleet:vehicle")])).not.toThrow();
  });

  test("accepts a local entity reference", () => {
    const feature = defineFeature("fleet", (r) => {
      r.entity("vehicle", { fields: { name: { type: "text", required: true } } });
      r.queryHandler(
        "find",
        z.object({ vehicleId: z.string().meta({ references: "vehicle" }) }),
        async () => ({}),
        {
          access: OPEN_ACCESS,
        },
      );
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
