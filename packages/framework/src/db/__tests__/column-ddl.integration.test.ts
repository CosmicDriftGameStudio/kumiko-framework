// DDL-Render-Test: alle pgTable Column-Types + Builder-Optionen.
import { describe, expect, test } from "bun:test";
import {
  bigint,
  bigserial,
  integer,
  jsonb,
  boolean as pgBoolean,
  table as pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "../dialect";
import { renderTableDdl } from "../render-ddl";

function findIndex(ddl: readonly string[], pattern: RegExp): boolean {
  return ddl.some((s) => pattern.test(s));
}

describe("renderTableDdl — column types", () => {
  test("uuid notNull primaryKey defaultRandom", () => {
    const t = pgTable("t_uuid", { id: uuid("id").primaryKey().defaultRandom() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid()');
  });

  test("text notNull unique", () => {
    const t = pgTable("t_text", { slug: text("slug").notNull().unique() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"slug" text NOT NULL');
    expect(findIndex(ddl, /UNIQUE INDEX/)).toBe(true);
  });

  test("integer default", () => {
    const t = pgTable("t_int", { count: integer("count").default(0) });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"count" integer DEFAULT 0');
  });

  test("serial primaryKey", () => {
    const t = pgTable("t_serial", { id: serial("id").primaryKey() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"id" serial PRIMARY KEY');
  });

  test("bigserial primaryKey", () => {
    const t = pgTable("t_bigserial", { id: bigserial("id").primaryKey() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"id" bigserial PRIMARY KEY');
  });

  test("bigint notNull", () => {
    const t = pgTable("t_bigint", { amount: bigint("amount").notNull() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"amount" bigint NOT NULL');
  });

  test("boolean default", () => {
    const t = pgTable("t_bool", { active: pgBoolean("active").default(true) });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"active" boolean DEFAULT true');
  });

  test("jsonb notNull", () => {
    const t = pgTable("t_jsonb", { data: jsonb("data").notNull() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"data" jsonb NOT NULL');
  });

  test("timestamptz defaultNow", () => {
    const t = pgTable("t_ts", {
      created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
    });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain('"created" timestamp with time zone DEFAULT now() NOT NULL');
  });

  test("bigint generatedAlwaysAsIdentity primaryKey", () => {
    const t = pgTable("t_ident", { id: bigint("id").primaryKey().generatedAlwaysAsIdentity() });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain("GENERATED ALWAYS AS IDENTITY");
    expect(ddl[0]).not.toContain("DEFAULT"); // identity replaces default
  });

  test("composite: multiple columns with various options", () => {
    const t = pgTable("t_composite", {
      pk: bigint("pk").primaryKey().generatedAlwaysAsIdentity(),
      name: text("name").notNull(),
      slug: text("slug").notNull().unique(),
      active: pgBoolean("active").default(true),
      data: jsonb("data"),
      created: timestamp("created", { withTimezone: true }).notNull().defaultNow(),
    });
    // biome-ignore lint/suspicious/noExplicitAny: DDL test uses cast for mock tables
    const ddl = renderTableDdl(t as any);
    expect(ddl[0]).toContain("GENERATED ALWAYS AS IDENTITY");
    expect(ddl[0]).toContain('"name" text NOT NULL');
    expect(ddl[0]).toContain('"active" boolean DEFAULT true');
    expect(ddl[0]).toContain('"data" jsonb');
    expect(findIndex(ddl, /UNIQUE INDEX.*slug/)).toBe(true);
  });
});
