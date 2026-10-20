import { describe, expect, test } from "bun:test";
import { createEntity, defineFeature } from "../index.ts";

const BAD_REASONS: { label: string; reason: string; message: RegExp }[] = [
  { label: "empty", reason: "", message: /non-empty/ },
  { label: "placeholder", reason: "todo", message: /placeholder/ },
];

describe.each(BAD_REASONS)(
  "escapeHatch with $label reason is rejected at registration",
  ({ reason, message }) => {
    test("r.job", () => {
      expect(() =>
        defineFeature("test", (r) => {
          r.job(
            "sweep",
            { trigger: { on: "test:write:thing:create" }, escapeHatch: { reason } },
            async () => {},
          );
        }),
      ).toThrow(message);
    });

    test("r.hook", () => {
      expect(() =>
        defineFeature("test", (r) => {
          const thing = r.entity({
            name: "thing",
            ...createEntity({ table: "things", fields: {} }),
          });
          r.hook({
            type: "postSave",
            target: { allOf: thing },
            handler: async () => undefined,
            escapeHatch: { reason },
          });
        }),
      ).toThrow(message);
    });

    test("r.useExtension", () => {
      expect(() =>
        defineFeature("test", (r) => {
          r.useExtension("someExtension", "thing", { escapeHatch: { reason } });
        }),
      ).toThrow(message);
    });
  },
);
