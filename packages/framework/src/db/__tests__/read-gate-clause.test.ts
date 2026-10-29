import { describe, expect, test } from "bun:test";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { createEntity, createFileField, createTextField } from "../../engine/factories.ts";
import { createSystemUser } from "../../engine/system-user.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { fileRefEntity } from "../../files/file-ref-entity.ts";
import { buildReadGateClause } from "../read-gate-clause.ts";
import { buildEntityTable } from "../table-builder.ts";
import type { TenantDb } from "../tenant-db.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const user: SessionUser = {
  id: "22222222-2222-4222-8222-222222222222",
  tenantId: TENANT,
  roles: ["Reader"],
  claims: {},
};
const admin: SessionUser = { ...user, roles: ["Admin"] };
const tenantDb = { mode: "tenant", tenantId: TENANT } as unknown as TenantDb;

const text = () =>
  createTextField({
    required: true,
    maxLength: 64,
    personal: false,
    reason: "technical_reference",
  });

const linkEntity = createEntity({
  table: "read_gate_links",
  fields: { documentId: text(), entityType: text(), entityId: text() },
  parentRef: { entityTypeField: "entityType", entityIdField: "entityId" },
});
const hostEntity = createEntity({
  table: "read_gate_hosts",
  fields: { name: text(), scan: createFileField() },
  access: { read: { Reader: "all" } },
});
const gatedEntity = createEntity({
  table: "read_gate_docs",
  fields: { title: text(), file: createFileField() },
  readGate: {
    anyLink: { entity: "link", field: "documentId" },
    fileOwner: { field: "file" },
    linkExemptRoles: ["Admin"],
  },
});

const entities = new Map<string, EntityDefinition>([
  ["document", gatedEntity],
  ["link", linkEntity],
  ["host", hostEntity],
  ["fileRef", fileRefEntity],
]);
const gatedTable = buildEntityTable("document", gatedEntity);

function build(who: SessionUser, canReadEntity: (name: string) => boolean = () => true) {
  return buildReadGateClause(gatedEntity, gatedTable, "docs_alias", who, tenantDb, {
    entities,
    canReadEntity,
  });
}

function sqlOf(clause: ReturnType<typeof build>) {
  if (clause.kind !== "sql") throw new Error(`expected sql, got ${clause.kind}`);
  return clause;
}

function maxPlaceholder(sqlText: string): number {
  return Math.max(0, ...[...sqlText.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
}

describe("buildReadGateClause", () => {
  test("is a no-op for an entity without a gate and for the framework system user", () => {
    const plain = buildReadGateClause(hostEntity, gatedTable, "t", user, tenantDb, { entities });
    expect(plain.kind).toBe("pass");
    const system = buildReadGateClause(
      gatedEntity,
      gatedTable,
      "t",
      createSystemUser(TENANT),
      tenantDb,
      {
        entities,
      },
    );
    expect(system.kind).toBe("pass");
  });

  test("fails closed without the registry", () => {
    const clause = buildReadGateClause(gatedEntity, gatedTable, "t", user, tenantDb, undefined);
    expect(clause.kind).toBe("empty");
  });

  test("aliases the link and file tables and numbers every placeholder it binds", () => {
    const { sqlText, params } = sqlOf(build(user));
    expect(sqlText).toContain('"read_gate_links" AS "gate_link"');
    expect(sqlText).toContain('"file_refs" AS "gate_file"');
    expect(sqlText).toContain('"docs_alias"');
    expect(maxPlaceholder(sqlText)).toBe(params.length);
    expect(params).toContain("host");
  });

  test("applies the owner's read rule inside the owner branch", () => {
    const { sqlText, params } = sqlOf(build(user));
    expect(sqlText).toContain('"read_gate_hosts"');
    expect(params).toContain("scan");
  });

  test("link-exempt roles skip the link requirement but keep the file-owner one", () => {
    const { sqlText } = sqlOf(build(admin));
    expect(sqlText).not.toContain("gate_link");
    expect(sqlText).toContain("gate_file");
  });

  test("an owner entity without a readable query handler contributes no branch", () => {
    const withoutHost = build(user, (name) => name !== "host");
    expect(sqlOf(withoutHost).sqlText).not.toContain('"read_gate_hosts"');
  });

  test("a role the owner's rule does not cover leaves only the self-owned branch", () => {
    const stranger: SessionUser = { ...user, roles: ["Stranger"] };
    const { sqlText } = sqlOf(build(stranger));
    expect(sqlText).not.toContain('"read_gate_hosts"');
    expect(sqlText).toContain('"docs_alias"."id"::text');
  });
});
