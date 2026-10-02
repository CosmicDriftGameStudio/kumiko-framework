import { describe, expect, test } from "bun:test";
import { evalFieldCondition, resolveNavParentScreen } from "../screen-helpers.js";
import type { FieldCondition, ScreenDefinition } from "../types/screen.js";

describe("evalFieldCondition()", () => {
  test("boolean forms pass through unchanged", () => {
    expect(evalFieldCondition(true, {})).toBe(true);
    expect(evalFieldCondition(false, {})).toBe(false);
  });

  test("eq matches when the field equals the given value", () => {
    const cond: FieldCondition = { field: "status", eq: "active" };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("ne matches when the field differs from the given value", () => {
    const cond: FieldCondition = { field: "status", ne: "archived" };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("in matches when the field is one of the given values", () => {
    const cond: FieldCondition = { field: "status", in: ["draft", "active"] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "archived" })).toBe(false);
  });

  test("notIn matches when the field is none of the given values", () => {
    const cond: FieldCondition = { field: "status", notIn: ["draft", "archived"] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, { status: "draft" })).toBe(false);
  });

  test("empty in is always false", () => {
    const cond: FieldCondition = { field: "status", in: [] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(false);
    expect(evalFieldCondition(cond, {})).toBe(false);
  });

  test("empty notIn is always true", () => {
    const cond: FieldCondition = { field: "status", notIn: [] };
    expect(evalFieldCondition(cond, { status: "active" })).toBe(true);
    expect(evalFieldCondition(cond, {})).toBe(true);
  });

  test("a missing field is undefined — in false, notIn true", () => {
    const values: Record<string, unknown> = {};
    expect(evalFieldCondition({ field: "status", in: ["active"] }, values)).toBe(false);
    expect(evalFieldCondition({ field: "status", notIn: ["active"] }, values)).toBe(true);
  });
});

describe("resolveNavParentScreen()", () => {
  const list: ScreenDefinition = {
    id: "widget-list",
    type: "entityList",
    entity: "widget",
    columns: ["name"],
    createScreen: "widget-wizard",
  };
  const wizard: ScreenDefinition = {
    id: "widget-wizard",
    type: "custom",
    renderer: { react: "W" },
  };
  const other: ScreenDefinition = { id: "other", type: "custom", renderer: { react: "O" } };

  test("an entityList is the parent of its createScreen target", () => {
    expect(resolveNavParentScreen([list, wizard], wizard, (s) => s.id)).toBe(list);
  });

  test("a screen the list does not name has no parent", () => {
    expect(resolveNavParentScreen([list, other], other, (s) => s.id)).toBeUndefined();
  });

  test("a fully-qualified rowAction target resolves its list", () => {
    const detail: ScreenDefinition = {
      id: "item-detail",
      type: "custom",
      renderer: { react: "D" },
    };
    const qnList: ScreenDefinition = {
      id: "item-list",
      type: "projectionList",
      query: "demo:query:item:list",
      columns: ["name"],
      rowActions: [
        { kind: "navigate", id: "open", label: "Open", screen: "other:screen:item-detail" },
      ],
    };
    expect(resolveNavParentScreen([qnList, detail], detail, (s) => s.id)).toBe(qnList);
  });

  test("a fully-qualified listScreenId resolves its list", () => {
    const detail: ScreenDefinition = {
      id: "item-detail",
      type: "custom",
      renderer: { react: "D" },
      listScreenId: "other:screen:widget-list",
    };
    expect(resolveNavParentScreen([list, detail], detail, (s) => s.id)).toBe(list);
  });
});
