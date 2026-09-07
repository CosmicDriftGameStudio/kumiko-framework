// fw#2629: `list()` guarded filtering/sorting only against unknown columns,
// not per-field `access.read`. A caller who cannot read a field could still
// filter or sort by it — result count and row order become an oracle for a
// value the response itself strips out (filterReadFields in
// engine/field-access.ts). This proves the fix over real HTTP: a filter on
// an unreadable field must be unsatisfiable (not merely "field stripped from
// the response"), and a sort on an unreadable field must fall back silently
// to the default id-ASC order.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query";
import { defineFeature } from "../../engine/define-feature";
import { createEntity, createTextField } from "../../engine/factories";
import { from } from "../../engine/ownership";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";

const filterNoteEntity = createEntity({
  table: "fa_filter_notes",
  fields: {
    title: createTextField({ required: true }),
    ownerId: createTextField({ required: true }),
    secret: createTextField({
      filterable: true,
      sortable: true,
      access: { read: { Admin: "all" } },
    }),
    ownedNote: createTextField({
      filterable: true,
      access: { read: { Admin: "all", User: from("user:id", "ownerId") } },
    }),
  },
});

const LIST_QN = "filternotes:query:note:list";

const filterNotesFeature = defineFeature("filternotes", (r) => {
  r.crud("note", filterNoteEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: true } },
  });
});

type NoteRow = {
  readonly id: string;
  readonly title: string;
  readonly ownerId: string;
  readonly secret?: string;
  readonly ownedNote?: string;
};

type ListResult = {
  readonly rows: readonly NoteRow[];
  readonly total?: number;
};

describe("list() field-level read access gates filter/sort (fw#2629)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [filterNotesFeature] });
    await unsafeCreateEntityTable(stack.db, filterNoteEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "fa_filter_notes"');
  });

  const CREATE = "filternotes:write:note:create";

  async function seedTwoSecrets(): Promise<void> {
    await stack.http.write(
      CREATE,
      { title: "Note A", ownerId: TestUsers.user.id, secret: "alpha" },
      TestUsers.admin,
    );
    await stack.http.write(
      CREATE,
      { title: "Note B", ownerId: TestUsers.user.id, secret: "beta" },
      TestUsers.admin,
    );
  }

  test("baseline: rows exist for a caller without read access to `secret`, but the field is stripped", async () => {
    await seedTwoSecrets();
    const result = await stack.http.queryOk<ListResult>(LIST_QN, { limit: 50 }, TestUsers.user);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.secret === undefined)).toBe(true);
  });

  test("count-channel oracle is closed: a matching and a non-matching filter on `secret` are indistinguishable", async () => {
    await seedTwoSecrets();

    const matching = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, totalCount: true, filter: { field: "secret", op: "eq", value: "alpha" } },
      TestUsers.user,
    );
    const nonExistent = await stack.http.queryOk<ListResult>(
      LIST_QN,
      {
        limit: 50,
        totalCount: true,
        filter: { field: "secret", op: "eq", value: "does-not-exist-anywhere" },
      },
      TestUsers.user,
    );

    expect(matching.rows).toHaveLength(0);
    expect(matching.total).toBe(0);
    expect(nonExistent.rows).toHaveLength(0);
    expect(nonExistent.total).toBe(0);
    expect(matching).toEqual(nonExistent);
  });

  test("count-channel oracle is closed for `ne` and `in` on `secret` too", async () => {
    await seedTwoSecrets();

    const ne = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, totalCount: true, filter: { field: "secret", op: "ne", value: "alpha" } },
      TestUsers.user,
    );
    const inOp = await stack.http.queryOk<ListResult>(
      LIST_QN,
      {
        limit: 50,
        totalCount: true,
        filters: [{ field: "secret", op: "in", value: ["alpha", "beta"] }],
      },
      TestUsers.user,
    );

    expect(ne.rows).toHaveLength(0);
    expect(ne.total).toBe(0);
    expect(inOp.rows).toHaveLength(0);
    expect(inOp.total).toBe(0);
  });

  test("a legitimate filter by a caller who CAN read the field still narrows results", async () => {
    await seedTwoSecrets();
    const result = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, totalCount: true, filter: { field: "secret", op: "eq", value: "alpha" } },
      TestUsers.admin,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe("Note A");
    expect(result.total).toBe(1);
  });

  test("ownership-typed filter binds the correct rule without corrupting later param placeholders", async () => {
    await stack.http.write(
      CREATE,
      { title: "Mine", ownerId: TestUsers.user.id, secret: "x", ownedNote: "shared-value" },
      TestUsers.admin,
    );
    await stack.http.write(
      CREATE,
      { title: "Theirs", ownerId: TestUsers.admin.id, secret: "y", ownedNote: "shared-value" },
      TestUsers.admin,
    );

    const result = await stack.http.queryOk<ListResult>(
      LIST_QN,
      {
        limit: 50,
        totalCount: true,
        filter: { field: "ownedNote", op: "eq", value: "shared-value" },
      },
      TestUsers.user,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.title).toBe("Mine");
    expect(result.total).toBe(1);
  });

  test("sort-channel oracle: sorting by an unreadable field falls back to id ASC", async () => {
    // id ASC (creation order) is [first, second]; secret DESC must reverse
    // that ("zzz" > "aaa") — the two orders disagree, so this actually
    // distinguishes "sort applied" from "sort silently ignored".
    const first = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "First", ownerId: TestUsers.user.id, secret: "aaa" },
      TestUsers.admin,
    );
    const second = await stack.http.writeOk<{ id: string }>(
      CREATE,
      { title: "Second", ownerId: TestUsers.user.id, secret: "zzz" },
      TestUsers.admin,
    );

    const asUser = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, sort: "secret", sortDirection: "desc" },
      TestUsers.user,
    );
    expect(asUser.rows.map((r) => r.id)).toEqual([first.id, second.id]);

    const asAdmin = await stack.http.queryOk<ListResult>(
      LIST_QN,
      { limit: 50, sort: "secret", sortDirection: "desc" },
      TestUsers.admin,
    );
    expect(asAdmin.rows.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});
