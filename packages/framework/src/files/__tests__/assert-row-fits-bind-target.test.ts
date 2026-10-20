import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createRegistry,
  defineFeature,
} from "../../engine/index.ts";
import { InternalError, UnprocessableError } from "../../errors/index.ts";
import { assertRowFitsBindTarget } from "../bind-pending-file-refs.ts";

const docEntity = createEntity({
  table: "bind_target_docs",
  fields: {
    copy: createFileField({
      personal: false,
      reason: "is_business_data",
      accept: ["pdf"],
      maxSize: "1MB",
    }),
  },
});
const registry = createRegistry([
  defineFeature("bind-target", (r) => {
    r.entity({ name: "doc", ...docEntity });
  }),
]);
const bindTo = { entityName: "doc", fieldName: "copy" } as const;
const fitting = {
  id: "f1",
  storageKey: "t/action-form/abc.pdf",
  mimeType: "application/pdf",
  size: 10,
};

describe("assertRowFitsBindTarget", () => {
  test("accepts a row that fits the target field", () => {
    expect(() => assertRowFitsBindTarget(registry, bindTo, fitting)).not.toThrow();
  });

  test("rejects a row outside the target accept", () => {
    expect(() =>
      assertRowFitsBindTarget(registry, bindTo, {
        ...fitting,
        storageKey: "t/action-form/abc.png",
      }),
    ).toThrow(UnprocessableError);
  });

  for (const missing of ["storageKey", "mimeType", "size"] as const) {
    test(`fails closed when ${missing} is missing`, () => {
      const { [missing]: _dropped, ...row } = fitting;
      expect(() => assertRowFitsBindTarget(registry, bindTo, row)).toThrow(InternalError);
    });
  }
});
