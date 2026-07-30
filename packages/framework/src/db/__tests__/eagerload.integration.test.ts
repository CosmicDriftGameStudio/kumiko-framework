// Coverage-Lücke (0 Test, 12% u+i): Server-Side-Eagerload für Reference-Felder.
// Schwerpunkt: Tenant-Isolation — ein Cross-Tenant-Ref darf NIE aufgelöst
// werden (TenantDb filtert), sonst leakt eagerload fremde Rows nach _refs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configurePiiSubjectKms,
  encryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "../../crypto";
import { createEntity, createTextField } from "../../engine";
import type { EntityDefinition } from "../../engine/types";
import { setupTestStack, type TestStack, testTenantId, unsafeCreateEntityTable } from "../../stack";
import { createTestEnvelopeCipher, resetPiiSubjectKmsForTests, seedRows } from "../../testing";
import {
  collectReferenceFields,
  type EagerloadedRow,
  enrichRowWithReferences,
  enrichWithReferences,
} from "../eagerload";
import {
  collectEncryptedFieldNames,
  configureEntityFieldEncryption,
  encryptEntityFieldValues,
  resetEntityFieldEncryptionCacheForTests,
} from "../entity-field-encryption";
import { buildEntityTable } from "../table-builder";
import { createTenantDb } from "../tenant-db";

const authorEntity = createEntity({
  table: "el_authors",
  fields: { name: createTextField({ required: true }) },
});
const postEntity = createEntity({
  table: "el_posts",
  fields: {
    title: createTextField({ required: true }),
    author: { type: "reference", entity: "author" },
    tags: { type: "reference", entity: "author", multiple: true },
  },
});
const authorTable = buildEntityTable("author", authorEntity);

// #1667: eager-loaded _refs bypassed PII/entity-field decryption entirely —
// a raw selectMany read the referenced row straight from the table, so
// piiCiphertextResponseGuard 500'd on the leaked ciphertext.
const contactEntity = createEntity({
  table: "el_contacts",
  fields: {
    name: createTextField({ required: true }),
    email: createTextField({ required: true, tenantOwned: true }),
    iban: createTextField({ required: true, encrypted: true }),
  },
});
const leadEntity = createEntity({
  table: "el_leads",
  fields: {
    title: createTextField({ required: true }),
    contact: { type: "reference", entity: "contact" },
  },
});
const contactTable = buildEntityTable("contact", contactEntity);

const resolve = (name: string): EntityDefinition | undefined => {
  if (name === "author") return authorEntity;
  if (name === "contact") return contactEntity;
  return undefined;
};

const tenantA = testTenantId(91);
const tenantB = testTenantId(92);

const A1 = "11111111-1111-4111-8111-111111111111";
const A2 = "22222222-2222-4222-8222-222222222222";
const BX = "33333333-3333-4333-8333-333333333333";
const NOPE = "55555555-5555-4555-8555-555555555555";

// _refs-Werte sind dynamisch gekeyt → bracket-access; Helper kapseln den Cast.
const single = (r: EagerloadedRow | undefined, f: string) =>
  r?._refs?.[f] as Record<string, unknown> | undefined;
const many = (r: EagerloadedRow | undefined, f: string) =>
  r?._refs?.[f] as ReadonlyArray<Record<string, unknown>> | undefined;

const CX = "44444444-4444-4444-8444-444444444444";
const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
const cipher = createTestEnvelopeCipher(TEST_KEY);
const kms = new InMemoryKmsAdapter();

let stack: TestStack;
let dbA: ReturnType<typeof createTenantDb>;

beforeAll(async () => {
  stack = await setupTestStack({ features: [] });
  await unsafeCreateEntityTable(stack.db, authorEntity);
  await unsafeCreateEntityTable(stack.db, contactEntity);
  dbA = createTenantDb(stack.db, tenantA, "tenant");

  await seedRows(stack.db, authorTable, [
    { id: A1, tenantId: tenantA, name: "Ada" },
    { id: A2, tenantId: tenantA, name: "Linus" },
    { id: BX, tenantId: tenantB, name: "Foreign" },
  ]);

  configureEntityFieldEncryption(cipher);
  configurePiiSubjectKms(kms);
  const plainContact = {
    id: CX,
    tenantId: tenantA,
    name: "Grace",
    email: "grace@acme.test",
    iban: "DE12345",
  };
  const piiEncrypted = await encryptPiiFieldValues(plainContact, contactEntity, ["email"], kms, {
    requestId: "test",
  });
  const encrypted = await encryptEntityFieldValues(
    piiEncrypted,
    collectEncryptedFieldNames(contactEntity),
    cipher,
  );
  await seedRows(stack.db, contactTable, [encrypted]);
});

afterAll(async () => {
  resetEntityFieldEncryptionCacheForTests();
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

async function enrichA(row: Record<string, unknown>): Promise<EagerloadedRow | undefined> {
  const [out] = (await enrichWithReferences([row], postEntity, resolve, dbA)) as EagerloadedRow[];
  return out;
}

describe("collectReferenceFields", () => {
  test("extrahiert reference-Felder, parst cross-feature-Prefix, flaggt multiple", () => {
    const e = createEntity({
      table: "x",
      fields: {
        title: createTextField(),
        author: { type: "reference", entity: "users:user" },
        tags: { type: "reference", entity: "tag", multiple: true },
      },
    });
    expect(collectReferenceFields(e)).toEqual([
      { fieldName: "author", refEntityName: "user", multiple: false },
      { fieldName: "tags", refEntityName: "tag", multiple: true },
    ]);
  });

  test("keine reference-Felder → leer", () => {
    expect(collectReferenceFields(authorEntity)).toEqual([]);
  });
});

describe("enrichWithReferences", () => {
  test("löst single-ref zur Row auf", async () => {
    const row = await enrichA({ id: "p1", author: A1 });
    expect(single(row, "author")?.["name"]).toBe("Ada");
  });

  test("löst multiple-ref zu einem Array in Reihenfolge auf", async () => {
    const row = await enrichA({ id: "p1", tags: [A2, A1] });
    expect(many(row, "tags")?.map((t) => t["name"])).toEqual(["Linus", "Ada"]);
  });

  test("null/leerer ref-Wert → _refs[field] undefined", async () => {
    const row = await enrichA({ id: "p1", author: null });
    expect(single(row, "author")).toBeUndefined();
  });

  // multiple-ref-Contract: IMMER ein Array (gefiltert), nie undefined — anders
  // als single (oben). Ein Renderer kann auf .map() vertrauen ohne null-Check.
  test("multiple-ref filtert cross-tenant raus, behält den Rest als Array", async () => {
    const row = await enrichA({ id: "p1", tags: [A1, BX] });
    expect(many(row, "tags")?.map((t) => t["name"])).toEqual(["Ada"]);
  });

  test("multiple-ref nur cross-tenant → [] (leeres Array, NICHT undefined)", async () => {
    const row = await enrichA({ id: "p1", tags: [BX] });
    expect(many(row, "tags")).toEqual([]);
  });

  test("multiple-ref null → [] (leeres Array, NICHT undefined)", async () => {
    const row = await enrichA({ id: "p1", tags: null });
    expect(many(row, "tags")).toEqual([]);
  });

  test("TENANT-ISOLATION: cross-tenant-ref wird NICHT aufgelöst", async () => {
    // bx gehört tenantB; dbA ist auf tenantA gescoped → der Lookup filtert
    // ihn raus, _refs bleibt undefined (Renderer fällt auf die UUID zurück).
    const row = await enrichA({ id: "p1", author: BX });
    expect(single(row, "author")).toBeUndefined();
  });

  test("dangling UUID (kein Row) → undefined, kein Crash", async () => {
    const row = await enrichA({ id: "p1", author: NOPE });
    expect(single(row, "author")).toBeUndefined();
  });

  test("unbekannte ref-Entity (resolve→undefined) → undefined, kein Crash", async () => {
    const [row] = (await enrichWithReferences(
      [{ id: "p1", author: A1 }],
      postEntity,
      () => undefined,
      dbA,
    )) as EagerloadedRow[];
    expect(single(row, "author")).toBeUndefined();
  });

  test("keine reference-Felder → flache Kopie ohne Lookup", async () => {
    const out = await enrichWithReferences([{ id: "x1", name: "n" }], authorEntity, resolve, dbA);
    expect(out).toEqual([{ id: "x1", name: "n" }]);
  });

  test("enrichRowWithReferences (single-row-Variante) stempelt _refs", async () => {
    const row = (await enrichRowWithReferences(
      { id: "p1", author: A1 },
      postEntity,
      resolve,
      dbA,
    )) as EagerloadedRow;
    expect(single(row, "author")?.["name"]).toBe("Ada");
  });

  test("#1667: referenzierte PII-/encrypted-Felder werden entschlüsselt, keine Ciphertext-Leaks", async () => {
    const [row] = (await enrichWithReferences(
      [{ id: "l1", contact: CX }],
      leadEntity,
      resolve,
      dbA,
    )) as EagerloadedRow[];
    const contact = single(row, "contact");

    expect(contact?.["email"]).toBe("grace@acme.test");
    expect(contact?.["iban"]).toBe("DE12345");
    expect(isPiiCiphertext(contact?.["email"])).toBe(false);
  });
});
