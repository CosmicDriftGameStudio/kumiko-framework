import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";

describe("validateBoot — projectionList screens", () => {
  test("rejects hand-written searchable:true when the query schema has no search param (3a)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: true,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/searchable: true.*"search"/);
  });

  test("requires defaultSort when the query schema accepts search (3b)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort required/);
  });

  test("requires defaultSort when the query schema accepts sort (3b)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({ sort: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/defaultSort required/);
  });

  test("passes when search/sort are active and defaultSort is set", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional(), sort: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: true,
        defaultSort: { field: "description", dir: "asc" },
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("passes when the schema offers neither search nor sort and no defaultSort is set", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects hand-written searchable:false when the query schema accepts search and the screen isn't whitelisted", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
        defaultSort: { field: "description", dir: "asc" },
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/searchable: false disables it/);
  });

  test("passes hand-written searchable:false on a whitelisted screen id even when the schema accepts search", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler(
        "schedule:list",
        z.object({ search: z.string().optional() }),
        async () => ({ rows: [], nextCursor: null }),
        { access: { openToAll: true } },
      );
      r.screen({
        id: "download-attempt-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        searchable: false,
      });
      r.translations({
        keys: { "screen:download-attempt-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects hand-authored sortable on a projectionList screen (fw#2165 review)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        sortable: true,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/sortable is derived/);
  });

  test("rejects hand-authored paginated on a projectionList screen (fw#2165 review)", () => {
    const feature = defineFeature("ledger", (r) => {
      r.queryHandler("schedule:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: true },
      });
      r.screen({
        id: "schedule-list",
        type: "projectionList",
        query: "ledger:query:schedule:list",
        columns: ["description"],
        paginated: false,
      });
      r.translations({
        keys: { "screen:schedule-list.title": { de: "Liste", en: "List" } },
      });
    });
    expect(() => validateBoot([feature])).toThrow(/paginated is derived/);
  });
});
