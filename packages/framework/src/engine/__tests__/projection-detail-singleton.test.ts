import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { withBootValidatorFixture } from "../../testing/boot-validator-fixture";
import { validateBoot as validateBootRaw } from "../boot-validator";
import { defineFeature } from "../define-feature";
import { createEntity, createTextField } from "../factories";

function validateBoot(features: Parameters<typeof validateBootRaw>[0]): void {
  validateBootRaw(withBootValidatorFixture(features));
}

// fw#2312: `singleton: true` marks a projectionDetail screen whose query
// determines the shown row from the caller's context (session), not a row
// id in the path — a self-service screen like "my profile". idParam names
// the query-payload key for a path row id, which a singleton screen never
// sends; detailFor drives the auto-generated "Edit" action's navigation via
// that same path id (fw#2166). Both combinations are rejected at boot
// instead of silently winning (idParam ignored / edit button opening a
// blank create form).
describe("validateBoot — projectionDetail singleton (fw#2312)", () => {
  test("singleton + idParam throws", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("me", z.object({}), async () => ({ id: "u1" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "profile",
        type: "projectionDetail",
        query: "app:query:me",
        singleton: true,
        idParam: "userId",
        layout: { sections: [{ title: "s", fields: ["id"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "profile" \(projectionDetail\) sets both singleton: true and idParam/,
    );
  });

  test("singleton + detailFor throws", () => {
    const feature = defineFeature("app", (r) => {
      r.entity("user", createEntity({ fields: { name: createTextField() } }));
      r.queryHandler("me", z.object({}), async () => ({ id: "u1" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "profile",
        type: "projectionDetail",
        query: "app:query:me",
        singleton: true,
        detailFor: "user",
        layout: { sections: [{ title: "s", fields: ["id"] }] },
      });
      r.screen({
        id: "user-edit",
        type: "entityEdit",
        entity: "user",
        layout: { sections: [{ columns: 1, fields: ["name"] }] },
      });
    });
    expect(() => validateBoot([feature])).toThrow(
      /Screen "profile" \(projectionDetail\) sets both singleton: true and detailFor/,
    );
  });

  test("singleton without idParam/detailFor boots cleanly", () => {
    const feature = defineFeature("app", (r) => {
      r.queryHandler("me", z.object({}), async () => ({ id: "u1" }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "profile",
        type: "projectionDetail",
        query: "app:query:me",
        singleton: true,
        layout: { sections: [{ title: "s", fields: ["id"] }] },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });
});
