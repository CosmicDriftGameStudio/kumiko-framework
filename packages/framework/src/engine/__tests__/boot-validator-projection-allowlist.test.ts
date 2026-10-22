import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { table as pgTable, text, uuid } from "../../db/dialect.ts";
import { validateBoot } from "../boot-validator.ts";
import { defineFeature } from "../define-feature.ts";
import { defineWriteHandler } from "../define-handler.ts";
import { stepsPipeline } from "../pipeline.ts";

const auditLogTable = pgTable("boot_allowlist_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  message: text("message").notNull(),
});

function featureWithProjectionWrite(declare: boolean) {
  return defineFeature("boot-allowlist", (r) => {
    if (declare) r.requires.projection("boot_allowlist_audit_log");
    r.writeHandler(
      defineWriteHandler({
        name: "log",
        schema: z.object({ msg: z.string() }),
        access: { roles: ["User"] },
        perform: stepsPipeline<{ msg: string }, { ok: true }>(({ event, r }) => [
          r.step.unsafeProjectionUpsert({
            table: auditLogTable,
            on: ["id"],
            row: () => ({ message: event.payload.msg }),
          }),
          r.step.return({ isSuccess: true as const, data: { ok: true } }),
        ]),
      }),
    );
  });
}

describe("validateBoot — projection allowlist", () => {
  test("fails when unsafeProjectionUpsert is used without r.requires.projection", () => {
    expect(() =>
      validateBoot(withBootValidatorFixture([featureWithProjectionWrite(false)])),
    ).toThrow(/did not declare it via r\.requires\.projection/);
  });

  test("boots when the projection is declared", () => {
    expect(() =>
      validateBoot(withBootValidatorFixture([featureWithProjectionWrite(true)])),
    ).not.toThrow();
  });
});
