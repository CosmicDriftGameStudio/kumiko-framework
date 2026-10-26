// `kumiko events prune` through runEventsCli against a plain (superuser, RLS off) database; the
// app-role path is covered in aggregate-type-removal-rls-app-role.integration.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { runEventsCli } from "../../events-cli.ts";
import { generateId } from "../../utils/index.ts";
import {
  count as countIn,
  createFixtureTables,
  FILE,
  feature,
  RELEASE,
  seedFixture,
} from "./aggregate-type-removal-fixture.ts";

const DB_NAME = `kumiko_evprune_cli_${generateId().slice(-8)}`;

let stack: TestStack;
let previousDatabaseUrl: string | undefined;

const count = (table: string, where?: string) => countIn(stack, table, where);

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], dbName: DB_NAME });
  await createFixtureTables(stack);
  previousDatabaseUrl = process.env["DATABASE_URL"];
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
  process.env["DATABASE_URL"] = baseUrl.replace(/\/[^/]+$/, `/${DB_NAME}`);
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  await stack.cleanup();
});

beforeEach(async () => {
  await seedFixture(stack);
});

describe("runEventsCli", () => {
  function capture() {
    const lines: string[] = [];
    return {
      lines,
      out: { log: (l: string) => lines.push(l), err: (l: string) => lines.push(`ERR ${l}`) },
    };
  }
  const options = { features: [feature], rowLevelSecurity: "off" } as const;

  test("dry run prints counts without row content and exits 0", async () => {
    const { out, lines } = capture();
    const code = await runEventsCli(["prune", "--aggregate-type", RELEASE], out, options);
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain(`${RELEASE}: 2 events, 2 aggregates, 1 tenants`);
    expect(text).toContain("Dry run");
    expect(text).not.toContain(process.env["DATABASE_URL"] ?? "unset");
    expect(await count("kumiko_events")).toBe(6);
  });

  test("--apply deletes through the CLI", async () => {
    const { out } = capture();
    const code = await runEventsCli(
      ["prune", "--aggregate-type", RELEASE, "--apply"],
      out,
      options,
    );
    expect(code).toBe(0);
    expect(await count("kumiko_events", `aggregate_type = '${RELEASE}'`)).toBe(0);
    expect(await count("kumiko_events", `aggregate_type = '${FILE}'`)).toBe(2);
  });

  test.each([
    [
      "unknown type",
      ["prune", "--aggregate-type", "no-such-type", "--apply"],
      "Unknown aggregate type",
    ],
    ["missing type", ["prune", "--apply"], "At least one"],
    ["unknown flag", ["prune", "--aggregate-type", RELEASE, "--force"], "Unknown argument"],
    ["unknown subcommand", ["purge"], "Unknown subcommand"],
  ])("%s exits non-zero and changes nothing", async (_name, argv, message) => {
    const { out, lines } = capture();
    expect(await runEventsCli(argv, out, options)).toBe(1);
    expect(lines.join("\n")).toContain(message);
    expect(await count("kumiko_events")).toBe(6);
    expect(await count("read_evprune_release")).toBe(1);
  });

  test("a valid type next to an unknown one deletes nothing", async () => {
    const { out } = capture();
    const code = await runEventsCli(
      ["prune", "--aggregate-type", RELEASE, "--aggregate-type", "no-such-type", "--apply"],
      out,
      options,
    );
    expect(code).toBe(1);
    expect(await count("kumiko_events", `aggregate_type = '${RELEASE}'`)).toBe(2);
  });
});
