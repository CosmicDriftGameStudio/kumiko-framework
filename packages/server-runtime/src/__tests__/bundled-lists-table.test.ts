import { describe, expect, test } from "bun:test";
import { createJobsFeature, JOBS_FEATURE } from "@cosmicdrift/kumiko-bundled-features/jobs";
import {
  type BundledListsOptions,
  createEntity,
  createTextField,
  defineFeature,
  type EditRelatedListSection,
  type FeatureDefinition,
  type ListColumnSpec,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import * as z from "zod";
import { composeAppFeatures } from "../boot/shared-boot-steps.ts";
import { composeFeatures } from "../compose-features.ts";

const FULL: BundledListsOptions = {
  table: {
    rememberState: true,
    resetAll: true,
    columnPicker: true,
    density: { default: "compact", userChoice: true },
    pinning: true,
    resizing: true,
    keyboardNavigation: true,
    export: { xlsx: true },
  },
  pinFirstColumn: true,
};

const OPEN_TO_ALL = { openToAll: { reason: "test handler callable by any signed-in test user" } };
const rowsSchema = z.object({
  rows: z.array(z.object({ id: z.string(), name: z.string() })),
  nextCursor: z.string().nullable(),
});
const ROWS_QN = "shop:query:item:rows";
const SHOP_COLUMNS: readonly ListColumnSpec[] = ["name"];

const shopFeature = defineFeature("shop", (r) => {
  r.entity({
    name: "item",
    ...createEntity({
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
  r.queryHandler({
    name: "item:rows",
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }),
    access: OPEN_TO_ALL,
    outputSchema: rowsSchema,
  });
  r.screen({
    id: "item-list",
    type: "entityList",
    entity: "item",
    columns: SHOP_COLUMNS,
    dormant: true,
  });
  r.screen({
    id: "item-detail",
    dormant: true,
    type: "projectionDetail",
    query: ROWS_QN,
    layout: {
      sections: [{ kind: "relatedList", title: "Rows", query: ROWS_QN, columns: SHOP_COLUMNS }],
    },
  });
});

// Reuses the bundled feature name so the mixing applies; its own keys must win.
const OWN_TABLE = { columnPicker: false, density: { default: "compact" } } as const;
const PINNED_COLUMNS: readonly ListColumnSpec[] = ["id", { field: "name", pinned: "right" }];
const jobsOverride = defineFeature(JOBS_FEATURE, (r) => {
  r.screen({
    id: "own-table",
    type: "projectionList",
    query: ROWS_QN,
    columns: ["id", "name"],
    table: OWN_TABLE,
  });
  r.screen({ id: "own-pin", type: "projectionList", query: ROWS_QN, columns: PINNED_COLUMNS });
  r.screen({
    id: "own-pinning-off",
    type: "projectionList",
    query: ROWS_QN,
    columns: ["id", "name"],
    table: { pinning: false },
  });
  r.screen({
    id: "own-object-column",
    type: "projectionList",
    query: ROWS_QN,
    columns: [{ field: "id", label: "jobs.id", width: 80 }, "name"],
  });
  r.screen({
    id: "own-hidden-first",
    type: "projectionList",
    query: ROWS_QN,
    columns: [{ field: "id", hidden: true }, "name"],
  });
  r.screen({
    id: "detail",
    type: "projectionDetail",
    query: ROWS_QN,
    layout: {
      sections: [
        {
          kind: "relatedList",
          title: "Rows",
          query: ROWS_QN,
          columns: ["id", "name"],
          table: { resizing: false },
        },
        { kind: "fields", title: "Fields", fields: ["name"] },
      ],
    },
  });
  r.entity({
    name: "run",
    ...createEntity({
      fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
    }),
  });
  r.screen({
    id: "edit",
    type: "entityEdit",
    entity: "run",
    dormant: true,
    layout: {
      sections: [
        { kind: "relatedList", title: "Rows", query: ROWS_QN, columns: ["id", "name"] },
        { kind: "fields", title: "Fields", fields: ["name"] },
      ],
    },
  });
});

function screenOf(features: readonly FeatureDefinition[], featureName: string, id: string) {
  const screen = features.find((f) => f.name === featureName)?.screens[id];
  if (screen === undefined) throw new Error(`screen ${featureName}/${id} missing`);
  return screen;
}

function listScreenOf(features: readonly FeatureDefinition[], featureName: string, id: string) {
  const screen = screenOf(features, featureName, id);
  if (screen.type !== "entityList" && screen.type !== "projectionList") {
    throw new Error(`screen ${featureName}/${id} is ${screen.type}, not a list`);
  }
  return screen;
}

function relatedListOf(
  features: readonly FeatureDefinition[],
  featureName: string,
  id: string,
): EditRelatedListSection {
  const screen = screenOf(features, featureName, id);
  if (screen.type !== "projectionDetail" && screen.type !== "entityEdit") {
    throw new Error(`${id} has no layout sections`);
  }
  const section = screen.layout.sections.find((s) => s.kind === "relatedList");
  if (section?.kind !== "relatedList") throw new Error(`${id} has no relatedList`);
  return section;
}

const withJobsOverride = () =>
  composeFeatures([jobsOverride], { includeBundled: false, bundledLists: FULL });

describe("composeFeatures bundledLists", () => {
  test("applies the block and pins the first column on bundled lists, leaves app features alone", () => {
    const features = composeFeatures([shopFeature], { includeBundled: true, bundledLists: FULL });

    const userList = listScreenOf(features, "user", "user-list");
    expect(userList.table).toEqual(FULL.table);
    expect(userList.columns[0]).toEqual({ field: "email", pinned: "left" });
    const original = listScreenOf(
      composeFeatures([], { includeBundled: true }),
      "user",
      "user-list",
    );
    expect(userList.columns.slice(1)).toEqual(original.columns.slice(1));

    const tenantList = listScreenOf(features, "tenant", "tenant-list");
    expect(tenantList.columns[0]).toEqual({ field: "key", pinned: "left" });

    const shopList = listScreenOf(features, "shop", "item-list");
    expect(shopList.table).toBeUndefined();
    expect(shopList.columns).toBe(SHOP_COLUMNS);
    expect(relatedListOf(features, "shop", "item-detail").table).toBeUndefined();

    expect(() => validateBoot(withBootValidatorFixture(features))).not.toThrow();
  });

  test("does not mutate the shared bundled screen constants", () => {
    const [jobs] = composeFeatures([createJobsFeature()], {
      includeBundled: false,
      bundledLists: FULL,
    });
    const mixed = listScreenOf(jobs ? [jobs] : [], JOBS_FEATURE, "job-runs");
    expect(mixed.table).toEqual(FULL.table);
    expect(mixed.columns[0]).toMatchObject({ field: "jobName", pinned: "left" });

    const plain = composeFeatures([createJobsFeature()], { includeBundled: false });
    expect(listScreenOf(plain, JOBS_FEATURE, "job-runs").table).toBeUndefined();
  });

  test("a screen's own table keys win per key", () => {
    const table = listScreenOf(withJobsOverride(), JOBS_FEATURE, "own-table").table;
    expect(table).toEqual({ ...FULL.table, ...OWN_TABLE });
    expect(table?.density).toEqual({ default: "compact" });
  });

  test("relatedList gets the block without export, own keys win, first column pinned", () => {
    const features = withJobsOverride();
    const section = relatedListOf(features, JOBS_FEATURE, "detail");
    const { export: _export, ...withoutExport } = FULL.table;
    expect(section.table).toEqual({ ...withoutExport, resizing: false });
    expect(section.columns[0]).toEqual({ field: "id", pinned: "left" });
    const detail = screenOf(features, JOBS_FEATURE, "detail");
    if (detail.type !== "projectionDetail") throw new Error("not a projectionDetail");
    expect(detail.layout.sections[1]).toEqual({
      kind: "fields",
      title: "Fields",
      fields: ["name"],
    });
  });

  test("entityEdit relatedList gets the block without export and the first column pinned", () => {
    const section = relatedListOf(withJobsOverride(), JOBS_FEATURE, "edit");
    const { export: _export, ...withoutExport } = FULL.table;
    expect(section.table).toEqual(withoutExport);
    expect(section.columns[0]).toEqual({ field: "id", pinned: "left" });
  });

  test("pinFirstColumn skips lists with a pinned column or pinning off, keeps object-column keys", () => {
    const features = withJobsOverride();
    expect(listScreenOf(features, JOBS_FEATURE, "own-pin").columns).toBe(PINNED_COLUMNS);
    const pinningOff = listScreenOf(features, JOBS_FEATURE, "own-pinning-off");
    expect(pinningOff.columns).toEqual(["id", "name"]);
    expect(listScreenOf(features, JOBS_FEATURE, "own-object-column").columns).toEqual([
      { field: "id", label: "jobs.id", width: 80, pinned: "left" },
      "name",
    ]);
  });

  test("without pinFirstColumn no column is pinned", () => {
    const features = composeFeatures([jobsOverride], {
      includeBundled: false,
      bundledLists: { table: FULL.table },
    });
    expect(listScreenOf(features, JOBS_FEATURE, "own-object-column").columns).toEqual([
      { field: "id", label: "jobs.id", width: 80 },
      "name",
    ]);
  });

  test("pins the first visible column when the first one starts hidden", () => {
    const features = withJobsOverride();
    expect(listScreenOf(features, JOBS_FEATURE, "own-hidden-first").columns).toEqual([
      { field: "id", hidden: true },
      { field: "name", pinned: "left" },
    ]);
  });

  test("undefined bundledLists keeps the feature objects", () => {
    const [feature] = composeFeatures([shopFeature], { includeBundled: false });
    expect(feature).toBe(shopFeature);
  });

  test("composing twice gives the same screens", () => {
    const once = withJobsOverride();
    const twice = composeFeatures([...once], { includeBundled: false, bundledLists: FULL });
    expect(twice).toEqual(once);
  });

  test("composeAppFeatures passes bundledLists through", () => {
    const features = composeAppFeatures([jobsOverride], [], undefined, FULL);
    expect(listScreenOf(features, JOBS_FEATURE, "own-object-column").table).toEqual(FULL.table);
  });

  test.each(["grouping", "totals"] as const)("rejects %s in the shared block", (key) => {
    const bundledLists: BundledListsOptions = {
      table: key === "grouping" ? { grouping: { field: "status" } } : { totals: [] },
    };
    expect(() => composeFeatures([shopFeature], { includeBundled: false, bundledLists })).toThrow(
      new RegExp(`bundledLists\\.table\\.${key}`),
    );
  });
});
