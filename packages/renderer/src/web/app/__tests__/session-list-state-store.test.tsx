import { beforeEach, describe, expect, test } from "bun:test";
import { getDefaultMemoryListStateStore } from "../../../components/list-state-store.tsx";
import {
  clearRememberedListState,
  createSessionListStateStore,
  resolveListStateStore,
} from "../session-list-state-store.ts";

const ANNA = { userId: "user-1", tenantId: "tenant-1" };

function storedKeys(): string[] {
  return Array.from({ length: window.sessionStorage.length }, (_, i) =>
    window.sessionStorage.key(i),
  ).filter((key): key is string => key !== null);
}

beforeEach(() => {
  clearRememberedListState();
  window.sessionStorage.clear();
});

describe("session list state store", () => {
  test("round-trips state under kumiko.list.<tenantId>.<userId>.<storeKey>", () => {
    const store = createSessionListStateStore(window.sessionStorage, ANNA);
    store.write("orders", { params: { q: "acme" }, view: { density: "compact" } });
    expect(window.sessionStorage.getItem("kumiko.list.tenant-1.user-1.orders")).not.toBeNull();
    expect(store.read("orders")).toEqual({ params: { q: "acme" }, view: { density: "compact" } });
    store.remove("orders");
    expect(store.read("orders")).toBeUndefined();
  });

  test("a missing tenant is keyed as '-'", () => {
    createSessionListStateStore(window.sessionStorage, { userId: "user-1" }).write("orders", {
      params: { q: "x" },
    });
    expect(storedKeys()).toEqual(["kumiko.list.-.user-1.orders"]);
  });

  test("a corrupt entry reads as nothing remembered", () => {
    window.sessionStorage.setItem("kumiko.list.tenant-1.user-1.orders", "{broken");
    expect(createSessionListStateStore(window.sessionStorage, ANNA).read("orders")).toBeUndefined();
  });

  test("a failing storage never throws into the list", () => {
    const failing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    const store = createSessionListStateStore(failing, ANNA);
    expect(store.read("orders")).toBeUndefined();
    expect(() => store.write("orders", { params: { q: "x" } })).not.toThrow();
  });

  test("another tenant starts without the previous one's state, the same identity keeps it", () => {
    resolveListStateStore(ANNA).write("orders", { params: { q: "acme" } });

    expect(resolveListStateStore(ANNA).read("orders")).toEqual({ params: { q: "acme" } });

    const other = resolveListStateStore({ userId: "user-1", tenantId: "tenant-2" });
    expect(other.read("orders")).toBeUndefined();
    expect(storedKeys().filter((k) => k.startsWith("kumiko.list.tenant-1."))).toEqual([]);
  });

  test("losing the identity at runtime empties session and memory state", () => {
    resolveListStateStore(ANNA).write("orders", { params: { q: "acme" } });
    getDefaultMemoryListStateStore().write("leftover", { params: { q: "x" } });

    resolveListStateStore(undefined);

    expect(storedKeys()).toEqual([]);
    expect(getDefaultMemoryListStateStore().read("leftover")).toBeUndefined();
  });

  test("an app without identity never writes to sessionStorage", () => {
    const store = resolveListStateStore(undefined);
    store.write("orders", { params: { q: "acme" } });
    expect(store.read("orders")).toEqual({ params: { q: "acme" } });
    expect(storedKeys()).toEqual([]);
  });

  test("clearRememberedListState removes every kumiko.list.* entry and the marker, not foreign keys", () => {
    resolveListStateStore(ANNA).write("orders", { params: { q: "acme" } });
    window.sessionStorage.setItem("other.app.key", "keep");

    clearRememberedListState();

    expect(storedKeys()).toEqual(["other.app.key"]);
    expect(window.sessionStorage.getItem("kumiko.list.identity")).toBeNull();
  });
});
