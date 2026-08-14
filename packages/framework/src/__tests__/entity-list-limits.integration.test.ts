// Security regression (2026-08-13 audit, Finding 3): entityListSchema's
// `limit`/`offset` used to accept fractional/oversized numbers, which flowed
// unvalidated into a raw `LIMIT ${limit} OFFSET ${offset}` SQL string
// (event-store-executor-read.ts) — a non-integer literal 500s, and an
// unbounded limit forces a full-table materialisation.
//
// Bun.SQL-only setup via setupTestStack.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
  MAX_LIST_LIMIT,
} from "../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../stack";

const widgetEntity = createEntity({
  table: "limit_widgets",
  fields: { name: createTextField({ required: true }) },
});

const widgetFeature = defineFeature("limitwidgets", (r) => {
  r.entity("widget", widgetEntity);
  r.writeHandler(
    defineEntityCreateHandler("widget", widgetEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(defineEntityListHandler("widget", widgetEntity, { access: { roles: ["Admin"] } }));
});

describe("entity list limit/offset validation", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [widgetFeature] });
    await unsafeCreateEntityTable(stack.db, widgetEntity);
  });

  afterAll(() => stack.cleanup());

  test("fractional limit is rejected with 400, not a 500 from the raw SQL LIMIT", async () => {
    const res = await stack.http.query(
      "limitwidgets:query:widget:list",
      { limit: 99999.5 },
      TestUsers.admin,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  test("negative offset is rejected with 400, not a 500 from the raw SQL OFFSET", async () => {
    const res = await stack.http.query(
      "limitwidgets:query:widget:list",
      { offset: -1 },
      TestUsers.admin,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  test("limit above MAX_LIST_LIMIT is rejected with 400", async () => {
    const res = await stack.http.query(
      "limitwidgets:query:widget:list",
      { limit: MAX_LIST_LIMIT + 1 },
      TestUsers.admin,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("validation_error");
  });

  test("limit at MAX_LIST_LIMIT and a valid offset succeed", async () => {
    const res = await stack.http.query(
      "limitwidgets:query:widget:list",
      { limit: MAX_LIST_LIMIT, offset: 0 },
      TestUsers.admin,
    );
    expect(res.status).toBe(200);
  });
});
