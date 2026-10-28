import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { buildingListSort, derivedFieldsSqlFeature } from "../feature";

type Row = Record<string, unknown>;
type Page = { readonly rows: readonly Row[] };

const LIST = "derived-fields-sql:query:building:list";
const user = createTestUser({ roles: ["User"], tenantId: testTenantId(1) });

let stack: TestStack;
const names = (page: Page): unknown[] => page.rows.map((row) => row["name"]);

beforeAll(async () => {
  stack = await setupTestStack({ features: [derivedFieldsSqlFeature], systemHooks: [] });
  const create = async (name: string, nickname?: string): Promise<string> => {
    const created = await stack.http.writeOk<{ id: string }>(
      "derived-fields-sql:write:building:create",
      { name, ...(nickname !== undefined && { nickname }) },
      user,
    );
    return created.id;
  };
  const ticket = (
    buildingId: string,
    title: string,
    status: string,
    openedOn: string,
    cost?: { amount: number; currency: string },
  ) =>
    stack.http.writeOk(
      "derived-fields-sql:write:ticket:create",
      { buildingId, title, status, openedOn, ...(cost !== undefined && { cost }) },
      user,
    );

  const harbor = await create("Harbor House", "The Harbor");
  const mill = await create("Old Mill");
  await create("Quiet Court");
  await ticket(harbor, "Roof leak", "open", "2026-01-10", { amount: 800, currency: "EUR" });
  await ticket(harbor, "Boiler", "inProgress", "2026-03-05", { amount: 1250.5, currency: "EUR" });
  await ticket(harbor, "Paint hall", "done", "2026-05-01");
  await ticket(mill, "Broken window", "open", "2026-02-02", { amount: 90, currency: "CHF" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("derived-fields-sql recipe", () => {
  test("coalesce falls back to the name when there is no nickname", async () => {
    const page = await stack.http.queryOk<Page>(LIST, { limit: 10 }, user);
    const shown = new Map(page.rows.map((row) => [row["name"], row["shownName"]]));

    expect(shown.get("Harbor House")).toBe("The Harbor");
    expect(shown.get("Old Mill")).toBe("Old Mill");
  });

  test("related count follows the where, first picks the newest ticket", async () => {
    const page = await stack.http.queryOk<Page>(LIST, { limit: 10 }, user);
    const harbor = page.rows.find((row) => row["name"] === "Harbor House");
    const quiet = page.rows.find((row) => row["name"] === "Quiet Court");

    expect(harbor?.["openTickets"]).toBe(2);
    // `first` ignores the where: it is the newest ticket by openedOn, done or not.
    expect(harbor?.["latestTicket"]).toBe("Paint hall");
    expect(quiet?.["openTickets"]).toBe(0);
    expect(quiet?.["latestTicket"]).toBeNull();
  });

  test("first on a money field arrives as amount and currency, absent when unset", async () => {
    const page = await stack.http.queryOk<Page>(LIST, { limit: 10 }, user);
    const byName = new Map(page.rows.map((row) => [row["name"], row]));

    expect(byName.get("Old Mill")?.["latestCost"]).toMatchObject({ amount: 90, currency: "CHF" });
    // Harbor's newest ticket has no cost: no key, like an unset stored money field.
    expect(Object.hasOwn(byName.get("Harbor House") ?? {}, "latestCost")).toBe(false);
  });

  test("a sortable derived column sorts on the server", async () => {
    const asc = await stack.http.queryOk<Page>(
      LIST,
      { sort: "shownName", sortDirection: "asc", limit: 10 },
      user,
    );

    expect(names(asc)).toEqual(["Old Mill", "Quiet Court", "Harbor House"]);
  });

  test("the screen's defaultSort on a derived value orders the list", async () => {
    const screen = createRegistry([derivedFieldsSqlFeature]).getScreen(
      "derived-fields-sql:screen:building-list",
    );
    const defaultSort = screen?.type === "entityList" ? screen.defaultSort : undefined;
    expect(defaultSort).toEqual(buildingListSort);

    const page = await stack.http.queryOk<Page>(
      LIST,
      { sort: defaultSort?.field, sortDirection: defaultSort?.dir, limit: 10 },
      user,
    );
    expect(names(page)).toEqual(["Harbor House", "Old Mill", "Quiet Court"]);
  });
});
