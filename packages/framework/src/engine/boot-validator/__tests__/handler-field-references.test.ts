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

  function keyedConsumer(references: unknown, wrap: (field: z.ZodString) => z.ZodType = (f) => f) {
    return defineFeature("planner", (r) => {
      r.writeHandler(
        "plan",
        z.object({ channelKeys: wrap(z.string().meta({ references })) }),
        noopHandler,
        { access: OPEN_ACCESS },
      );
    });
  }

  function channelFeature() {
    return defineFeature("channels", (r) => {
      r.entity("channel", { fields: { key: { type: "text", required: true } } });
    });
  }

  test("accepts by on an existing target field", () => {
    expect(() =>
      validateBoot([channelFeature(), keyedConsumer({ entity: "channels:channel", by: "key" })]),
    ).not.toThrow();
  });

  test("accepts an array field with by and a cross-feature entity", () => {
    const feature = defineFeature("planner", (r) => {
      r.writeHandler(
        "plan",
        z.object({
          channelKeys: z.array(z.string()).meta({
            references: { entity: "channels:channel", by: "key" },
          }),
        }),
        noopHandler,
        { access: OPEN_ACCESS },
      );
    });
    expect(() => validateBoot([channelFeature(), feature])).not.toThrow();
  });

  test("rejects by naming a field the target entity does not have", () => {
    expect(() =>
      validateBoot([channelFeature(), keyedConsumer({ entity: "channels:channel", by: "slug" })]),
    ).toThrow(/channelKeys.*"plan".*"channels:channel" by "slug".*no field "slug"/s);
  });

  test("rejects an invalid references meta", () => {
    expect(() => validateBoot([channelFeature(), keyedConsumer({ by: "key" })])).toThrow(
      /channelKeys.*invalid meta references/s,
    );
    expect(() => validateBoot([channelFeature(), keyedConsumer(42)])).toThrow(
      /channelKeys.*invalid meta references/s,
    );
  });
});

describe("validateBoot — nested handler field references", () => {
  function nestedConsumer(references: unknown) {
    return defineFeature("planner", (r) => {
      r.writeHandler(
        "plan",
        z.object({
          channels: z.array(z.object({ channelKey: z.string().meta({ references }) })),
        }),
        noopHandler,
        { access: OPEN_ACCESS },
      );
    });
  }

  const channelFeature = defineFeature("channels", (r) => {
    r.entity("channel", { fields: { key: { type: "text", required: true } } });
  });

  test("names the nested path for an unknown entity", () => {
    expect(() => validateBoot([channelFeature, nestedConsumer("nope")])).toThrow(
      /Input field "channels\[\]\.channelKey" of write handler "plan".*not a registered entity/s,
    );
  });

  test("names the nested path for an unknown by field", () => {
    expect(() =>
      validateBoot([channelFeature, nestedConsumer({ entity: "channels:channel", by: "nope" })]),
    ).toThrow(/Input field "channels\[\]\.channelKey".*no field "nope"/s);
  });

  test("names the nested path for invalid meta", () => {
    expect(() => validateBoot([channelFeature, nestedConsumer(42)])).toThrow(
      /Input field "channels\[\]\.channelKey".*invalid meta references/s,
    );
  });

  test("accepts a valid nested reference", () => {
    expect(() =>
      validateBoot([channelFeature, nestedConsumer({ entity: "channels:channel", by: "key" })]),
    ).not.toThrow();
  });
});
