import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../../db/query.ts";
import type { SessionUser } from "../../../engine/index.ts";
import type { TenantId } from "../../../engine/types/identifiers.ts";
import { TestUsers } from "../../../seeding/seed-users.ts";
import type { TokenVerifier } from "../../auth-middleware.ts";
import {
  ADMIN_SCREEN,
  CREATE_ITEM,
  customerEntity,
  exportFeature,
  itemEntity,
  LIST_SCREEN,
  OPEN_SCREEN,
  PLAIN_SCREEN,
  ROWS_SCREEN,
} from "./export-xlsx-fixture.ts";
import { type ParsedSheet, readXlsx } from "./read-xlsx.ts";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ALL_COLUMNS = ["title", "qty", "amount", "dueOn", "placedAt", "status", "active", "vaultKey"];
const PAT_TOKEN = "kpat_export-test-token";

const patUser: SessionUser = {
  id: "export-pat-user",
  tenantId: "00000000-0000-4000-8000-000000000001" as TenantId,
  roles: ["Admin"],
  pat: { tokenId: "export-pat-token", scopes: ["xl:read"], allowedQns: ["xl:query:*"] },
};
const tokenVerifier: TokenVerifier = async (raw) => (raw === PAT_TOKEN ? patUser : null);

type ErrorBody = {
  readonly error: {
    readonly code: string;
    readonly httpStatus?: number;
    readonly i18nKey: string;
    readonly details?: { readonly maxRows?: number; readonly fields?: readonly { code: string }[] };
  };
};

describe("POST /api/export/xlsx", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [exportFeature],
      authConfig: { membershipQuery: "xl:query:nonexistent", tokenVerifier },
    });
    await unsafeCreateEntityTable(stack.db, customerEntity);
    await unsafeCreateEntityTable(stack.db, itemEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "xl_items"');
    await asRawClient(stack.db).unsafe('DELETE FROM "xl_customers"');
  });

  async function createItem(fields: Record<string, unknown>, user: SessionUser = admin) {
    await stack.http.writeOk(
      CREATE_ITEM,
      {
        title: "item",
        qty: 1,
        amount: { amount: 1, currency: "EUR" },
        dueOn: "2026-03-05",
        placedAt: "2026-03-05T13:30:00.000Z",
        status: "open",
        active: true,
        vaultKey: "s3cret-value",
        ...fields,
      },
      user,
    );
  }

  async function exportRequest(
    body: unknown,
    user: SessionUser = admin,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const token = await stack.jwt.sign(user);
    return stack.http.raw("POST", "/api/export/xlsx", body, {
      Authorization: `Bearer ${token}`,
      ...headers,
    });
  }

  async function exportSheet(
    body: unknown,
    user: SessionUser = admin,
    headers: Record<string, string> = {},
  ): Promise<ParsedSheet> {
    const res = await exportRequest(body, user, headers);
    expect(res.status).toBe(200);
    return readXlsx(await res.arrayBuffer());
  }

  const titles = (sheet: ParsedSheet): string[] =>
    sheet.rows.slice(1).map((row) => row[0]?.text ?? "");

  async function expectRejected(res: Response, status: number, code: string): Promise<ErrorBody> {
    expect(res.status).toBe(status);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe(code);
    return body;
  }

  test("writes visible columns in client order with typed cells and download headers", async () => {
    await createItem({
      title: "alpha",
      qty: 2,
      amount: { amount: 10.5, currency: "EUR" },
      status: "paid",
    });
    const res = await exportRequest({ screen: LIST_SCREEN, columns: ALL_COLUMNS });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(XLSX_TYPE);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="item-list-\d{4}-\d{2}-\d{2}\.xlsx"$/,
    );

    const sheet = readXlsx(await res.arrayBuffer());
    expect(sheet.rows).toHaveLength(2);
    const [header, row] = sheet.rows;
    // vaultKey is sensitive: dropped from the file entirely
    expect(header?.map((c) => c.text)).toEqual([
      "Title",
      "Quantity",
      "Amount",
      "Due on",
      "Placed at",
      "Status",
      "Active",
    ]);
    expect(header?.every((c) => c.t === "s")).toBe(true);
    expect(row).toHaveLength(7);
    const [title, qty, amount, dueOn, placedAt, status, active] = row ?? [];
    expect(title).toMatchObject({ t: "s", text: "alpha" });
    expect(qty).toMatchObject({ t: undefined, raw: "2" });
    expect(amount).toMatchObject({ t: undefined, raw: "10.5" });
    expect(amount?.style).toBeDefined();
    expect(dueOn).toMatchObject({ t: undefined, raw: "46086" });
    expect(dueOn?.style).toBeDefined();
    expect(placedAt).toMatchObject({ t: undefined, raw: "46086.5625" });
    expect(placedAt?.style).toBeDefined();
    expect(status).toMatchObject({ t: "s", text: "Paid" });
    expect(active?.t).toBe("b");
    expect(sheet.rows.flat().some((c) => c.text.includes("s3cret"))).toBe(false);
  });

  test("a column whose read roles the user lacks is left out", async () => {
    await createItem({ title: "alpha", adminNote: "internal" });
    const asUser = await exportSheet(
      { screen: LIST_SCREEN, columns: ["title", "adminNote"] },
      TestUsers.user,
    );
    expect(asUser.rows[0]?.map((c) => c.text)).toEqual(["Title"]);
    const asAdmin = await exportSheet({ screen: LIST_SCREEN, columns: ["title", "adminNote"] });
    expect(asAdmin.rows[1]?.map((c) => c.text)).toEqual(["alpha", "internal"]);
  });

  test("a formula-looking title stays a shared string and no formula is written", async () => {
    await createItem({ title: "=1+1" });
    const sheet = await exportSheet({ screen: LIST_SCREEN, columns: ["title"] });
    expect(sheet.rows[1]?.[0]).toMatchObject({ t: "s", text: "=1+1" });
    expect(sheet.hasFormula).toBe(false);
  });

  test("facet filters in the payload narrow the rows", async () => {
    await createItem({ title: "alpha", qty: 5 });
    await createItem({ title: "beta", qty: 1 });
    const sheet = await exportSheet({
      screen: LIST_SCREEN,
      payload: { filters: [{ field: "qty", op: "gt", value: 2 }] },
      columns: ["title"],
    });
    expect(titles(sheet)).toEqual(["alpha"]);
  });

  test("client limit, aggregate and a foreign filter are ignored; the screen filter wins", async () => {
    await createItem({ title: "one", status: "open" });
    await createItem({ title: "two", status: "open" });
    await createItem({ title: "three", status: "paid" });
    const sheet = await exportSheet({
      screen: OPEN_SCREEN,
      payload: {
        limit: 1,
        offset: 1,
        aggregate: { groupBy: "status" },
        filter: { field: "status", op: "eq", value: "paid" },
        sort: "title",
      },
      columns: ["title", "status"],
    });
    expect(titles(sheet)).toEqual(["one", "two"]);
  });

  test("rows of another tenant are not exported", async () => {
    await createItem({ title: "mine" });
    await createItem({ title: "theirs" }, TestUsers.otherTenant);
    const sheet = await exportSheet({ screen: LIST_SCREEN, columns: ["title"] });
    expect(titles(sheet)).toEqual(["mine"]);
  });

  test("more rows than maxRows answers 413; exactly maxRows succeeds", async () => {
    for (let i = 0; i < 5; i++) await createItem({ title: `row-${i}` });
    const exact = await exportSheet({ screen: LIST_SCREEN, columns: ["title"] });
    expect(exact.rows).toHaveLength(6);

    await createItem({ title: "row-5" });
    const res = await exportRequest({ screen: LIST_SCREEN, columns: ["title"] });
    const body = await expectRejected(res, 413, "export_too_many_rows");
    expect(body.error.httpStatus).toBe(413);
    expect(body.error.i18nKey).toBe("kumiko.list.export-too-many");
    expect(body.error.details).toEqual({ maxRows: 5 });
  });

  test("exports a projectionList through its bound query", async () => {
    const sheet = await exportSheet({ screen: ROWS_SCREEN, columns: ["label", "score"] });
    expect(sheet.rows.map((r) => r.map((c) => c.text))).toEqual([
      ["label", "score"],
      ["alpha", "1"],
      ["beta", "2"],
      ["gamma", "3"],
    ]);
    expect(sheet.rows[1]?.[1]?.t).toBeUndefined();
  });

  test.each([
    [
      "an unknown screen",
      { screen: "xl:screen:nope", columns: ["title"] },
      "export_unknown_screen",
    ],
    ["a malformed screen id", { screen: "../etc", columns: ["title"] }, "export_unknown_screen"],
    ["a screen without export", { screen: PLAIN_SCREEN, columns: ["title"] }, "export_not_enabled"],
    [
      "an unknown column",
      { screen: LIST_SCREEN, columns: ["title", "nope"] },
      "export_unknown_column",
    ],
    [
      "only hidden-secret columns",
      { screen: LIST_SCREEN, columns: ["vaultKey"] },
      "export_no_columns",
    ],
    ["an empty column list", { screen: LIST_SCREEN, columns: [] }, "export_invalid_request"],
    ["a missing body field", { columns: ["title"] }, "export_invalid_request"],
  ])("%s is a 400 validation error", async (_label, body, reason) => {
    const res = await exportRequest(body);
    const err = await expectRejected(res, 400, "validation_error");
    expect(err.error.details?.fields?.[0]?.code).toBe(reason);
  });

  test("a user without screen access gets 403", async () => {
    const res = await exportRequest({ screen: ADMIN_SCREEN, columns: ["title"] }, TestUsers.user);
    await expectRejected(res, 403, "access_denied");
  });

  test("a personal access token cannot reach the export route", async () => {
    const res = await stack.http.raw(
      "POST",
      "/api/export/xlsx",
      { screen: LIST_SCREEN, columns: ["title"] },
      { Authorization: `Bearer ${PAT_TOKEN}` },
    );
    expect(res.status).toBe(403);
  });

  test("an unauthenticated request is rejected", async () => {
    const res = await stack.http.raw("POST", "/api/export/xlsx", {
      screen: LIST_SCREEN,
      columns: ["title"],
    });
    expect(res.status).toBe(401);
  });
});
