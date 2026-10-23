// Pins what executor.list()/detail() actually return per field type, and that the
// EntityRow<E> type says exactly that. The runtime assertions are the source of truth: when
// the read path (coerceRow, rehydrateCompoundTypes, decryptForRead) changes shape, the first
// half fails; when EntityRow drifts from it, the type assertions in the second half fail at
// compile time.

import { afterAll, beforeAll, describe, expect, expectTypeOf, test } from "bun:test";
import {
  createTestEnvelopeCipher,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "../../crypto/index.ts";
import {
  createBigIntField,
  createBooleanField,
  createDateField,
  createDecimalField,
  createEmbeddedField,
  createEmbeddedListField,
  createEntity,
  createFilesField,
  createImageField,
  createImagesField,
  createJsonbField,
  createLocatedTimestampField,
  createLongTextField,
  createMoneyField,
  createMultiSelectField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import {
  configureEntityFieldEncryption,
  resetEntityFieldEncryptionCacheForTests,
} from "../entity-field-encryption.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import type { LocatedTimestampRead } from "../located-timestamp.ts";
import type { MoneyRead } from "../money.ts";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../row-level-security-scope.ts";
import { buildEntityTable, type EntityRow } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";

const cipher = createTestEnvelopeCipher(
  Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64"),
);

const shapeEntity = createEntity({
  table: "read_row_shapes",
  softDelete: true,
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    note: createTextField({ personal: false, reason: "test_fixture" }),
    secret: createTextField({
      personal: false,
      reason: "test_fixture",
      encrypted: true,
      required: true,
    }),
    email: createTextField({ personal: "self", find: "none" }),
    story: createLongTextField({ required: true, personal: false, reason: "test_fixture" }),
    done: createBooleanField({ default: false }),
    flag: createBooleanField(),
    qty: createNumberField({ required: true }),
    rate: createDecimalField({ precision: 10, scale: 2, required: true }),
    big: createBigIntField({ required: true }),
    price: createMoneyField({ required: true }),
    optPrice: createMoneyField(),
    day: createDateField({ required: true }),
    optDay: createDateField(),
    at: createTimestampField({ required: true }),
    seen: createLocatedTimestampField({ required: true }),
    optSeen: createLocatedTimestampField(),
    zone: createTzField({ required: true }),
    status: createSelectField({ options: ["open", "closed"], required: true }),
    tags: createMultiSelectField({ options: ["a", "b"] }),
    owner: { type: "reference", entity: "user" },
    owners: { type: "reference", entity: "user", multiple: true },
    cover: createImageField(),
    gallery: createImagesField(),
    docs: createFilesField(),
    meta: createJsonbField(),
    address: createEmbeddedField({ street: { type: "text" } }),
    lines: createEmbeddedListField({ label: { type: "text" } }),
  },
});
type ShapeRow = EntityRow<typeof shapeEntity>;

const plainEntity = createEntity({
  table: "read_row_shapes_plain",
  fields: { title: createTextField({ required: true, personal: false, reason: "test_fixture" }) },
});

const admin = TestUsers.admin;
let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, shapeEntity, "shape");
  await unsafeCreateEntityTable(stack.db, plainEntity, "plain");
  tdb = createTenantDb({ db: stack.unscopedDb, tenantId: admin.tenantId });
  configureEntityFieldEncryption(cipher);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetEntityFieldEncryptionCacheForTests();
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

describe("executor.detail()/list() row shape", () => {
  const executor = createEventStoreExecutor(buildEntityTable("shape", shapeEntity), shapeEntity, {
    entityName: "shape",
  });

  const inTenantScope = <T>(fn: () => Promise<T>) =>
    runInRowLevelSecurityScope(tenantRowLevelSecurityScope(admin.tenantId), fn);

  const createRow = (): Promise<ShapeRow> => inTenantScope(createRowInScope);

  async function createRowInScope(): Promise<ShapeRow> {
    const created = await executor.create(
      {
        title: "t",
        secret: "s3",
        email: "a@b.c",
        story: "long",
        qty: 3,
        rate: 1.25,
        big: 9,
        price: { amount: 1.5, currency: "EUR" },
        day: Temporal.PlainDate.from("2026-01-02"),
        at: Temporal.Instant.from("2026-01-02T03:04:05Z"),
        seen: { at: "2026-01-02T03:04:05", tz: "Europe/Berlin" },
        zone: "Europe/Berlin",
        status: "open",
        tags: ["a"],
        owners: [],
        gallery: [],
        docs: [],
        meta: { k: 1 },
        address: { street: "Main" },
        lines: [{ label: "l" }],
      },
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error(`create failed: ${JSON.stringify(created)}`);
    const row = await executor.detail({ id: created.data.id }, admin, tdb);
    if (row === null) throw new Error("detail returned null");
    return row;
  }

  test("detail() and list() return the same keys and value kinds", async () => {
    const detail = await createRow();
    const listed = (await inTenantScope(() => executor.list({ limit: 50 }, admin, tdb))).rows;
    const fromList = listed.find((r) => r.id === detail.id);
    expect(fromList).toEqual(detail);
  });

  test("base columns, soft-delete columns and scalars", async () => {
    const row = await createRow();
    expect(typeof row.id).toBe("string");
    expect(row.tenantId).toBe(admin.tenantId);
    expect(row.version).toBe(1);
    expect(row.insertedAt).toBeInstanceOf(Temporal.Instant);
    expect(row.modifiedAt).toBeNull();
    expect(row.insertedById).toBe(admin.id);
    expect(row.modifiedById).toBeNull();
    expect(row.isDeleted).toBe(false);
    expect(row.deletedAt).toBeNull();
    expect(row.deletedById).toBeNull();
    expect(row.title).toBe("t");
    expect(row.note).toBeNull();
    expect(row.secret).toBe("s3");
    expect(row.email).toBe("a@b.c");
    expect(row.story).toBe("long");
    expect(row.done).toBe(false);
    expect(row.flag).toBe(false);
    expect(row.qty).toBe(3);
    expect(row.rate).toBe(1.25);
    expect(row.zone).toBe("Europe/Berlin");
    expect(row.status).toBe("open");
    expect(row.owner).toBeNull();
    expect(row.cover).toBeNull();
    expect(row.tags).toEqual(["a"]);
    expect(row.owners).toEqual([]);
    expect(row.gallery).toEqual([]);
    expect(row.docs).toEqual([]);
  });

  test("temporal fields are Temporal instances, not strings", async () => {
    const row = await createRow();
    expect(row.day).toBeInstanceOf(Temporal.PlainDate);
    expect(row.at).toBeInstanceOf(Temporal.Instant);
    expect("optDay" in row && row.optDay === null).toBe(true);
  });

  test("money and locatedTimestamp are one object key; the column pair does not leak", async () => {
    const row = await createRow();
    expect(row.price).toEqual({
      amount: 1.5,
      currency: "EUR",
      amountScaled: 150,
      amountMinor: 150,
    });
    expect(row.seen).toEqual({
      at: "2026-01-02T03:04:05",
      tz: "Europe/Berlin",
      utc: "2026-01-02T02:04:05Z",
    });
    expect("priceCurrency" in row).toBe(false);
    expect("seenUtc" in row).toBe(false);
    expect("seenTz" in row).toBe(false);
  });

  test("an unset money or locatedTimestamp field is absent, not null", async () => {
    const row = await createRow();
    expect("optPrice" in row).toBe(false);
    expect("optSeen" in row).toBe(false);
  });

  test("jsonb and embedded values come back as parsed objects", async () => {
    const row = await createRow();
    expect(row.meta).toEqual({ k: 1 });
    expect(row.address).toEqual({ street: "Main" });
    expect(row.lines).toEqual([{ label: "l" }]);
    expect(typeof row.big === "number" || typeof row.big === "bigint").toBe(true);
  });

  test("the row type states exactly that", async () => {
    const row = await createRow();
    expectTypeOf(row.id).toEqualTypeOf<string>();
    expectTypeOf(row.version).toEqualTypeOf<number>();
    expectTypeOf(row.insertedAt).toEqualTypeOf<Temporal.Instant>();
    expectTypeOf(row.modifiedAt).toEqualTypeOf<Temporal.Instant | null>();
    expectTypeOf(row.title).toEqualTypeOf<string>();
    expectTypeOf(row.note).toEqualTypeOf<string | null>();
    expectTypeOf(row.secret).toEqualTypeOf<string>();
    expectTypeOf(row.story).toEqualTypeOf<string>();
    expectTypeOf(row.done).toEqualTypeOf<boolean>();
    expectTypeOf(row.flag).toEqualTypeOf<boolean>();
    expectTypeOf(row.qty).toEqualTypeOf<number>();
    expectTypeOf(row.rate).toEqualTypeOf<number>();
    expectTypeOf(row.price).toEqualTypeOf<MoneyRead>();
    expectTypeOf(row.optPrice).toEqualTypeOf<MoneyRead | undefined>();
    expectTypeOf(row.seen).toEqualTypeOf<LocatedTimestampRead>();
    expectTypeOf(row.optSeen).toEqualTypeOf<LocatedTimestampRead | undefined>();
    expectTypeOf(row.day).toEqualTypeOf<Temporal.PlainDate>();
    expectTypeOf(row.optDay).toEqualTypeOf<Temporal.PlainDate | null>();
    expectTypeOf(row.at).toEqualTypeOf<Temporal.Instant>();
    expectTypeOf(row.zone).toEqualTypeOf<string>();
    expectTypeOf(row.status).toEqualTypeOf<string>();
    expectTypeOf(row.tags).toEqualTypeOf<readonly string[]>();
    expectTypeOf(row.owner).toEqualTypeOf<string | null>();
    expectTypeOf(row.owners).toEqualTypeOf<readonly string[]>();
    expectTypeOf(row.cover).toEqualTypeOf<string | null>();
    expectTypeOf(row.gallery).toEqualTypeOf<readonly string[]>();
    expectTypeOf(row.docs).toEqualTypeOf<readonly string[]>();
    expectTypeOf(row.big).toBeUnknown();
    expectTypeOf(row.meta).toBeUnknown();
    // createEntity widens softDelete to boolean, so the keys are present only on soft-delete
    // entities.
    expectTypeOf(row.isDeleted).toEqualTypeOf<boolean | undefined>();
    // The blind-index and money/locatedTimestamp column pairs are not row keys.
    // @ts-expect-error -- folded into `price`
    row.priceCurrency;
    // @ts-expect-error -- folded into `seen`
    row.seenUtc;
  });
});

describe("EntityRow<E> and the executor signature", () => {
  test("a typed executor is assignable to the untyped EventStoreExecutor", () => {
    const typed = createEventStoreExecutor(buildEntityTable("plain", plainEntity), plainEntity, {
      entityName: "plain",
    });
    expectTypeOf(typed.detail).returns.resolves.toEqualTypeOf<EntityRow<
      typeof plainEntity
    > | null>();
    const untyped: import("../event-store-executor.ts").EventStoreExecutor = typed;
    expect(untyped).toBe(typed);
  });

  test("a wide EntityDefinition yields Record<string, unknown>", () => {
    expectTypeOf<EntityRow>().toEqualTypeOf<Record<string, unknown>>();
  });
});
