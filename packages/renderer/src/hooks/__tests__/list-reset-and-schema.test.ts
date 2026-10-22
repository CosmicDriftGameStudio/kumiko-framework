import { describe, expect, test } from "bun:test";
import { isListStateAtDefault, listResetUpdates } from "../list-reset.ts";
import { parseStoredListStateJson, sanitizeStoredListState } from "../list-state-schema.ts";

describe("list reset", () => {
  test("only the page param counts as default", () => {
    expect(isListStateAtDefault({ "orders.page": "3" }, "orders")).toBe(true);
    expect(isListStateAtDefault({ "orders.q": "acme" }, "orders")).toBe(false);
    expect(isListStateAtDefault({ "orders.f.status": "~" }, "orders")).toBe(false);
  });

  test("the exact screen prefix is matched, a longer screen id is left alone", () => {
    const params = { "orders.q": "a", "orders-archive.q": "b", other: "c" };
    expect(listResetUpdates(params, "orders")).toEqual({ "orders.q": null });
  });

  test("the no-filter marker is cleared like any other list key", () => {
    expect(listResetUpdates({ "orders.f.status": "~" }, "orders")).toEqual({
      "orders.f.status": null,
    });
  });
});

describe("stored list state", () => {
  const known = { columnFields: ["name", "city"], filterFields: ["status", "created"] };

  test("malformed storage reads as nothing remembered", () => {
    expect(parseStoredListStateJson("{not json")).toBeUndefined();
    expect(parseStoredListStateJson(JSON.stringify({ params: { q: 1 } }))).toBeUndefined();
    expect(parseStoredListStateJson(JSON.stringify({ view: { density: "huge" } }))).toBeUndefined();
  });

  test("keys and columns the screen no longer has are dropped", () => {
    const sanitized = sanitizeStoredListState(
      {
        params: {
          q: "x",
          sort: "name",
          "f.status": "open",
          "f.gone": "1",
          "f.created.from": "d",
          junk: "1",
        },
        view: {
          columns: [
            { field: "name", visible: true },
            { field: "removed", visible: false },
          ],
          density: "compact",
        },
      },
      known,
    );
    expect(sanitized?.params).toEqual({
      q: "x",
      sort: "name",
      "f.status": "open",
      "f.created.from": "d",
    });
    expect(sanitized?.view?.columns).toEqual([{ field: "name", visible: true }]);
    expect(sanitized?.view?.density).toBe("compact");
  });
});
