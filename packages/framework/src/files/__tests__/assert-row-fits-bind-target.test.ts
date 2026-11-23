import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createFileField,
  createImageField,
  createRegistry,
  defineFeature,
} from "../../engine/index.ts";
import { InternalError, UnprocessableError } from "../../errors/index.ts";
import { assertRowFitsBindTarget } from "../bind-pending-file-refs.ts";

const docEntity = createEntity({
  name: "doc",
  table: "bind_target_docs",
  fields: {
    copy: createFileField({
      personal: false,
      reason: "is_business_data",
      accept: ["pdf"],
      maxSize: "1MB",
    }),
    defaultImage: createImageField({ personal: false, reason: "is_business_data" }),
    openImage: createImageField({ personal: false, reason: "is_business_data", accept: [] }),
    looseFile: createFileField({ personal: false, reason: "is_business_data" }),
  },
});
const registry = createRegistry([
  defineFeature("bind-target", (r) => {
    r.entity(docEntity);
  }),
]);
// What rebindFileRef passes: the field's own accept, no image default.
const rawAccept = (fieldDef: { readonly accept?: readonly string[] }) => fieldDef.accept;
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

  describe("image field default accept", () => {
    const imageRow = (storageKey: string, mimeType = "image/svg+xml") => ({
      ...fitting,
      storageKey,
      mimeType,
    });

    test("an image field without accept rejects an svg row", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "defaultImage" },
          imageRow("t/action-form/abc.svg"),
        ),
      ).toThrow(UnprocessableError);
    });

    test("pending .svg upload bound to an image field without accept", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "defaultImage" },
          imageRow("t/action-form/abc.svg"),
        ),
      ).toThrow(UnprocessableError);
    });

    test("stored .svg row moves onto an image field without accept", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "defaultImage" },
          imageRow("t/doc/1/img/abc.svg"),
          rawAccept,
        ),
      ).not.toThrow();
    });

    test("a move onto a field with an explicit accept stays strict", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          bindTo,
          { ...fitting, storageKey: "t/x/abc.png" },
          rawAccept,
        ),
      ).toThrow(UnprocessableError);
    });

    test("an image field without accept takes a jpg row", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "defaultImage" },
          imageRow("t/action-form/abc.jpg", "image/jpeg"),
        ),
      ).not.toThrow();
    });

    test("an image field with accept [] takes an svg row", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "openImage" },
          imageRow("t/action-form/abc.svg"),
        ),
      ).not.toThrow();
    });

    test("a file field without accept takes an svg row", () => {
      expect(() =>
        assertRowFitsBindTarget(
          registry,
          { entityName: "doc", fieldName: "looseFile" },
          imageRow("t/action-form/abc.svg"),
        ),
      ).not.toThrow();
    });
  });

  for (const missing of ["storageKey", "mimeType", "size"] as const) {
    test(`fails closed when ${missing} is missing`, () => {
      const { [missing]: _dropped, ...row } = fitting;
      expect(() => assertRowFitsBindTarget(registry, bindTo, row)).toThrow(InternalError);
    });
  }
});
