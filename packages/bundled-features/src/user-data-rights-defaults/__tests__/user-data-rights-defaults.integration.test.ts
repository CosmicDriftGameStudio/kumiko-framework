// userData-Hook Integration-Tests (S2.H1+H2).
//
// User-Explicit-Checks aus der Sprint-2-Anfrage:
//   - "alle daten enthalten" (Export-Bundle hat user-Profil + fileRefs)
//   - "PII check in daten" (Forget anonymisiert email/displayName,
//     Export-Bundle hat keine passwordHash/roles)
//   - "exporte + fristen, nach loeschfrist sollte es keine daten mehr
//     haben" (Forget mit strategy=delete entfernt PII; tieferer
//     Frist-Test in S2.U5/S2.T1 wenn Cron-Pipeline da)
//   - "cross data matrix checks" (Cross-Tenant-Isolation: Tenant A's
//     fileRef-Forget beruehrt Tenant B's Files nicht)

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { variantSuffix } from "@cosmicdrift/kumiko-framework/derivatives";
import {
  createEntity,
  createFileField,
  createImageField,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createInMemoryFileProvider,
  deriveKey,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createDataRetentionFeature } from "../../data-retention";
import { fileFoundationFeature } from "../../file-foundation";
import { createFilesFeature } from "../../files";
import { createSessionsFeature } from "../../sessions";
import {
  createUserFeature,
  USER_ANONYMIZED_DISPLAY_NAME,
  USER_DELETED_DISPLAY_NAME,
  USER_STATUS,
  userEntity,
  userTable,
} from "../../user";
import { createUserDataRightsFeature } from "../../user-data-rights";
import { createUserDataRightsDefaultsFeature } from "../feature";
import { fileRefDeleteHook, fileRefExportHook, userDeleteHook, userExportHook } from "../index";

let stack: TestStack;

// #3005 fixture: a business entity with file fields covering the three
// field-annotation shapes fileRefDeleteHook must branch on — explicitly
// non-personal (dealer's own business data), personal (self), and no
// annotation at all (the conservative "no annotation" case).
const vehicleEntity = createEntity({
  table: "test_vehicles",
  fields: {
    dealerPhoto: createImageField({
      personal: false,
      reason: "dealer_business_data_test_fixture",
    }),
    driverSelfie: createImageField({ personal: "self" }),
    unannotatedDoc: createFileField(),
  },
});

const vehicleFeature = defineFeature("testVehicleFileFields", (r) => {
  r.entity("vehicle", vehicleEntity);
});

// The vehicle fixture's image/file fields make server.ts's boot guard require
// a mounted file-storage provider (registryDeclaresFileFields). The hook
// tests below never resolve a provider through the registry — each passes
// its own `buildStorageProvider` directly — so this one only exists to
// satisfy that boot check.
const bootGuardFileProvider = createInMemoryFileProvider();
const testFileProviderFeature = defineFeature("testFileProviderBootGuard", (r) => {
  r.requires("file-foundation");
  r.useExtension("fileProvider", "test", { build: async () => bootGuardFileProvider });
});

const features = [
  createUserFeature(),
  createConfigFeature(),
  createFilesFeature(),
  fileFoundationFeature,
  testFileProviderFeature,
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  authFoundationFeature,
  createSessionsFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
  vehicleFeature,
];

beforeAll(async () => {
  stack = await setupTestStack({ features });

  // userEntity via Framework-Helper migrieren (kennt softDelete +
  // automatische tenant_id-Spalte — die manuell-CREATE wuerde mit
  // Drizzle-Generated-Queries kollidieren).
  await unsafeCreateEntityTable(stack.db, userEntity);

  // file_refs ist jetzt das buildEntityTable-getriebene fileRef-Entity
  // (softDelete → is_deleted/deleted_at/deleted_by_id). Echte Entity-Tabelle
  // pushen statt hand-CREATE, damit der is_deleted-Filter der Hooks greift.
  await unsafePushTables(stack.db, { fileRefsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

// fileRef-IDs muessen UUID sein (file_refs.id ist UUID per S0.1+S1.5).
// Helper baut zaehlerbasierte UUIDs damit Tests deterministisch.
function uuid(suffix: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${suffix.toString(16).padStart(12, "0")}`;
}

async function seedUser(id: string, overrides: Record<string, unknown> = {}): Promise<void> {
  // Drizzle-Insert nutzt Schema (incl. framework-managed tenantId-Spalte).
  // user-Entity ist tenant-agnostisch im Domain-Sinn, aber das DB-
  // Schema hat tenant_id-Spalte automatisch (Framework-Default).
  // Pragmatisch: SYSTEM_TENANT_ID fuer User-Rows in Tests.
  await seedRow(stack.db, userTable, {
    id,
    tenantId: SYSTEM_TENANT_ID,
    email: `user-${id}@example.com`,
    passwordHash: "hashed-password",
    displayName: `User ${id}`,
    locale: "de",
    emailVerified: true,
    roles: '["Member"]',
    status: USER_STATUS.Active,
    ...overrides,
  });
}

async function seedFileRef(
  id: string,
  tenantId: string,
  insertedById: string | null,
  fileName: string,
): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
    VALUES ($1, $2, $3, $4, 'application/pdf', 1024, $5)
    ON CONFLICT (id) DO NOTHING
  `,
    [id, tenantId, `storage/${id}`, fileName, insertedById],
  );
}

// #3005: seeds a fileRef attached to an entity/field, for testing the
// per-row PII-vs-business-data decision in fileRefDeleteHook.
async function seedFileRefWithField(
  id: string,
  tenantId: string,
  insertedById: string,
  entityType: string | null,
  fieldName: string | null,
  fileName: string,
): Promise<void> {
  await asRawClient(stack.db).unsafe(
    `
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, entity_type, entity_id, field_name, inserted_by_id)
    VALUES ($1, $2, $3, $4, 'image/jpeg', 1024, $5, $6, $7, $8)
    ON CONFLICT (id) DO NOTHING
  `,
    [
      id,
      tenantId,
      `storage/${id}`,
      fileName,
      entityType,
      entityType !== null ? "1" : null,
      fieldName,
      insertedById,
    ],
  );
}

async function fetchUser(id: string) {
  const result = await asRawClient(stack.db).unsafe(
    `
    SELECT id, email, display_name, password_hash, status, deleted_at
    FROM read_users WHERE id = $1
  `,
    [id],
  );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute returns any-typed array
  const rows = ((result as any).rows ?? result) as Array<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    status: string;
    deleted_at: string | null;
  }>;
  return rows[0] ?? null;
}

async function fetchFileRefs(tenantId: string, insertedById?: string | null) {
  const result =
    insertedById === undefined
      ? await asRawClient(stack.db).unsafe(`SELECT * FROM file_refs WHERE tenant_id = $1`, [
          tenantId,
        ])
      : insertedById === null
        ? await asRawClient(stack.db).unsafe(
            `SELECT * FROM file_refs WHERE tenant_id = $1 AND inserted_by_id IS NULL`,
            [tenantId],
          )
        : await asRawClient(stack.db).unsafe(
            `SELECT * FROM file_refs WHERE tenant_id = $1 AND inserted_by_id = $2`,
            [tenantId, insertedById],
          );
  // biome-ignore lint/suspicious/noExplicitAny: drizzle execute typing
  return (result as any).rows ?? result;
}

describe("user-data-rights-defaults :: feature loads", () => {
  test("Boot ist clean (5 features in der requires-Chain)", () => {
    expect(stack).toBeDefined();
  });
});

describe("S2.H1 :: userExportHook", () => {
  test("liefert Profil-JSON ohne passwordHash + roles (PII-Check)", async () => {
    await seedUser(uuid(1001), { displayName: "Marc" });

    const result = await userExportHook({
      db: createTenantDb(stack.db, TENANT_A, "tenant"),
      registry: stack.registry,
      tenantId: TENANT_A,
      userId: uuid(1001),
    });

    expect(result).toBeDefined();
    expect(result?.entity).toBe("user");
    expect(result?.rows).toHaveLength(1);
    const profile = result?.rows[0];
    expect(String(profile?.["email"])).toContain("@example.com");
    expect(profile?.["displayName"]).toBe("Marc");
    expect(profile?.["locale"]).toBe("de");
    // PII-Check: KEINE passwordHash + roles im Bundle
    expect(profile?.["passwordHash"]).toBeUndefined();
    expect(profile?.["roles"]).toBeUndefined();
    expect(profile?.["status"]).toBeUndefined();
  });

  test("returns null wenn User nicht existiert", async () => {
    const result = await userExportHook({
      db: createTenantDb(stack.db, TENANT_A, "tenant"),
      registry: stack.registry,
      tenantId: TENANT_A,
      userId: uuid(1002),
    });
    expect(result).toBeNull();
  });
});

describe("S2.H1 :: userDeleteHook", () => {
  test('strategy="delete" → softDelete + email/displayName anonymisiert + status=deleted', async () => {
    await seedUser(uuid(1003));

    await userDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: uuid(1003),
      },
      "delete",
    );

    const row = await fetchUser(uuid(1003));
    expect(row).not.toBeNull();
    if (!row) throw new Error("row should exist");
    expect(row.email).toContain("anonymized.invalid"); // PII raus
    expect(row.email).not.toContain("@example.com"); // urspruengliche email weg
    expect(row.display_name).toBe(USER_DELETED_DISPLAY_NAME);
    expect(row.password_hash).toBeNull();
    expect(row.status).toBe(USER_STATUS.Deleted);
    expect(row.deleted_at).not.toBeNull(); // softDelete-Timestamp gesetzt
  });

  test('strategy="anonymize" → email/displayName anonymisiert aber status bleibt active', async () => {
    await seedUser(uuid(1004));

    await userDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: uuid(1004),
      },
      "anonymize",
    );

    const row = await fetchUser(uuid(1004));
    if (!row) throw new Error("row should exist");
    expect(row.email).toContain("anonymized.invalid");
    expect(row.display_name).toBe(USER_ANONYMIZED_DISPLAY_NAME);
    expect(row.status).toBe(USER_STATUS.Active); // NICHT auf deleted
    expect(row.deleted_at).toBeNull(); // KEIN softDelete
  });

  test("idempotent: zweiter delete-Call crasht nicht UND State bleibt korrekt deleted", async () => {
    await seedUser(uuid(1005));

    await userDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: uuid(1005),
      },
      "delete",
    );
    const afterFirst = await fetchUser(uuid(1005));
    if (!afterFirst) throw new Error("user should exist after first delete");

    // Zweiter Call: kein Crash + State unverändert
    await expect(
      userDeleteHook(
        {
          db: createTenantDb(stack.db, TENANT_A, "tenant"),
          registry: stack.registry,
          tenantId: TENANT_A,
          userId: uuid(1005),
        },
        "delete",
      ),
    ).resolves.toBeUndefined();

    // State-Verifikation (S2.H1+H2-Audit N3): Row weiterhin deleted,
    // kein Status-Reset, anonymisierte Werte unverändert.
    const afterSecond = await fetchUser(uuid(1005));
    if (!afterSecond) throw new Error("user should exist after second delete");
    expect(afterSecond.status).toBe(USER_STATUS.Deleted);
    expect(afterSecond.display_name).toBe(USER_DELETED_DISPLAY_NAME);
    expect(afterSecond.password_hash).toBeNull();
    expect(afterSecond.email).toBe(afterFirst.email); // gleicher Wert, nicht "neu anonymisiert"
  });
});

describe("S2.H2 :: fileRefExportHook", () => {
  test("liefert FileRef-Metadata + signed-URL-Liste fuer Sprint-2.U3 ZIP-Bau", async () => {
    await seedFileRef(uuid(101), TENANT_A, "user-files-1", "lebenslauf.pdf");
    await seedFileRef(uuid(102), TENANT_A, "user-files-1", "anschreiben.pdf");

    const result = await fileRefExportHook({
      db: createTenantDb(stack.db, TENANT_A, "tenant"),
      registry: stack.registry,
      tenantId: TENANT_A,
      userId: "user-files-1",
    });

    expect(result?.entity).toBe("fileRef");
    expect(result?.rows).toHaveLength(2);
    expect(result?.fileRefs).toHaveLength(2);
    const names = result?.fileRefs?.map((f) => f.fileName).sort();
    expect(names).toEqual(["anschreiben.pdf", "lebenslauf.pdf"]);
  });

  test("returns null wenn User keine Files hat", async () => {
    const result = await fileRefExportHook({
      db: createTenantDb(stack.db, TENANT_A, "tenant"),
      registry: stack.registry,
      tenantId: TENANT_A,
      userId: "ghost-user-no-files",
    });
    expect(result).toBeNull();
  });
});

describe("S2.H2 :: fileRefDeleteHook", () => {
  test('strategy="delete" → FileRef-Rows fuer User in Tenant weg', async () => {
    await seedFileRef(uuid(201), TENANT_A, "user-delete-files", "f1.pdf");
    await seedFileRef(uuid(202), TENANT_A, "user-delete-files", "f2.pdf");

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: "user-delete-files",
      },
      "delete",
    );

    const remaining = await fetchFileRefs(TENANT_A, "user-delete-files");
    expect(remaining).toHaveLength(0);
  });

  test('strategy="anonymize" → insertedById=null, Files bleiben', async () => {
    await seedFileRef(uuid(203), TENANT_A, "user-anon-files", "shared.pdf");

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: "user-anon-files",
      },
      "anonymize",
    );

    const ownedAfter = await fetchFileRefs(TENANT_A, "user-anon-files");
    expect(ownedAfter).toHaveLength(0); // keiner mehr mit insertedById=user
    const anonymized = await fetchFileRefs(TENANT_A, null);
    const file = anonymized.find((f: { id: string }) => f.id === uuid(203));
    expect(file).toBeDefined();
    expect(file.inserted_by_id).toBeNull();
  });

  test("Cross-Tenant-Isolation: Tenant A's Forget beruehrt Tenant B's Files nicht (User-explicit)", async () => {
    await seedFileRef(uuid(301), TENANT_A, "shared-user", "tenantA.pdf");
    await seedFileRef(uuid(302), TENANT_B, "shared-user", "tenantB.pdf");

    // Tenant A loescht alle Files von "shared-user"
    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: "shared-user",
      },
      "delete",
    );

    const aRemaining = await fetchFileRefs(TENANT_A, "shared-user");
    const bRemaining = await fetchFileRefs(TENANT_B, "shared-user");

    expect(aRemaining).toHaveLength(0); // Tenant A: weg
    expect(bRemaining).toHaveLength(1); // Tenant B: unangetastet
    expect(bRemaining[0]?.file_name).toBe("tenantB.pdf");
  });

  test("idempotent: zweiter delete-Call crasht nicht UND DB-State bleibt 0 Files", async () => {
    await seedFileRef(uuid(401), TENANT_A, "user-idem-files", "f.pdf");

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId: "user-idem-files",
      },
      "delete",
    );
    const afterFirst = await fetchFileRefs(TENANT_A, "user-idem-files");
    expect(afterFirst).toHaveLength(0);

    // Zweiter Call: kein Crash + State weiter 0 Files
    await expect(
      fileRefDeleteHook(
        {
          db: createTenantDb(stack.db, TENANT_A, "tenant"),
          registry: stack.registry,
          tenantId: TENANT_A,
          userId: "user-idem-files",
        },
        "delete",
      ),
    ).resolves.toBeUndefined();
    const afterSecond = await fetchFileRefs(TENANT_A, "user-idem-files");
    expect(afterSecond).toHaveLength(0);
  });
});

describe("S2.H2 :: fileRefDeleteHook — per-row PII decision (issue #3005)", () => {
  test('strategy="delete" — field explicitly non-personal (dealer business data): binary + row survive, insertedById=null', async () => {
    const userId = "user-dealer-photo";
    await seedFileRefWithField(
      uuid(601),
      TENANT_A,
      userId,
      "vehicle",
      "dealerPhoto",
      "vehicle-front.jpg",
    );

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
      },
      "delete",
    );

    const ownedAfter = await fetchFileRefs(TENANT_A, userId);
    expect(ownedAfter).toHaveLength(0);
    const anonymized = await fetchFileRefs(TENANT_A, null);
    const row = anonymized.find((f: { id: string }) => f.id === uuid(601));
    expect(row).toBeDefined();
    expect(row.inserted_by_id).toBeNull();
  });

  test('strategy="delete" — field marked personal (self): binary + row are gone', async () => {
    const userId = "user-driver-selfie";
    await seedFileRefWithField(
      uuid(602),
      TENANT_A,
      userId,
      "vehicle",
      "driverSelfie",
      "selfie.jpg",
    );

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
      },
      "delete",
    );

    const remaining = await fetchFileRefs(TENANT_A);
    expect(remaining.find((f: { id: string }) => f.id === uuid(602))).toBeUndefined();
  });

  test('strategy="delete" — unattached upload (entityType/fieldName both null): hard-deleted', async () => {
    const userId = "user-unattached-hard";
    await seedFileRefWithField(uuid(603), TENANT_A, userId, null, null, "loose-file.pdf");

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
      },
      "delete",
    );

    const remaining = await fetchFileRefs(TENANT_A);
    expect(remaining.find((f: { id: string }) => f.id === uuid(603))).toBeUndefined();
  });

  test('strategy="delete" — field exists but carries no annotation: anonymized, not hard-deleted', async () => {
    const userId = "user-unannotated-field";
    await seedFileRefWithField(uuid(604), TENANT_A, userId, "vehicle", "unannotatedDoc", "doc.pdf");

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
      },
      "delete",
    );

    const ownedAfter = await fetchFileRefs(TENANT_A, userId);
    expect(ownedAfter).toHaveLength(0);
    const anonymized = await fetchFileRefs(TENANT_A, null);
    const row = anonymized.find((f: { id: string }) => f.id === uuid(604));
    expect(row).toBeDefined();
    expect(row.inserted_by_id).toBeNull();
  });

  test('strategy="delete" — entityType not resolvable in the registry: anonymized, never a silent hard-delete', async () => {
    const userId = "user-unresolvable-entity";
    await seedFileRefWithField(
      uuid(605),
      TENANT_A,
      userId,
      "no-such-entity",
      "somefield",
      "orphaned.pdf",
    );

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
      },
      "delete",
    );

    const ownedAfter = await fetchFileRefs(TENANT_A, userId);
    expect(ownedAfter).toHaveLength(0);
    const anonymized = await fetchFileRefs(TENANT_A, null);
    const row = anonymized.find((f: { id: string }) => f.id === uuid(605));
    expect(row).toBeDefined();
    expect(row.inserted_by_id).toBeNull();
  });
});

describe("S2.H2 :: fileRefDeleteHook — GDPR derivatives survive forget (issue #2461)", () => {
  async function seedFileRefWithKey(
    id: string,
    tenantId: string,
    insertedById: string,
    storageKey: string,
  ): Promise<void> {
    await asRawClient(stack.db).unsafe(
      `
      INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
      VALUES ($1, $2, $3, 'photo.jpg', 'image/jpeg', 2048, $4)
      ON CONFLICT (id) DO NOTHING
    `,
      [id, tenantId, storageKey, insertedById],
    );
  }

  test('strategy="delete" removes the original AND its derivatives, but spares an unrelated same-prefix sibling', async () => {
    const userId = "user-derivatives-files";
    const originalKey = `derivatives-test/${uuid(501)}.jpg`;
    const derivedKey = deriveKey(originalKey, variantSuffix("thumb", { maxEdge: 256 }));
    // Same base as originalKey (only the extension differs) — a plain
    // prefix-delete would sweep this up too; the grammar-anchored filter
    // must not.
    const siblingKey = `derivatives-test/${uuid(501)}.png`;

    const provider = createInMemoryFileProvider();
    await provider.write(originalKey, new Uint8Array([1]));
    await provider.write(derivedKey, new Uint8Array([2]));
    await provider.write(siblingKey, new Uint8Array([3]));

    await seedFileRefWithKey(uuid(501), TENANT_A, userId, originalKey);

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
        buildStorageProvider: async () => provider,
      },
      "delete",
    );

    expect(await provider.exists(originalKey)).toBe(false);
    expect(await provider.exists(derivedKey)).toBe(false);
    expect(await provider.exists(siblingKey)).toBe(true);

    const remaining = await fetchFileRefs(TENANT_A, userId);
    expect(remaining).toHaveLength(0);
  });

  test('strategy="anonymize" leaves original AND derivative binaries untouched', async () => {
    const userId = "user-anon-derivatives-files";
    const originalKey = `derivatives-test/${uuid(502)}.jpg`;
    const derivedKey = deriveKey(originalKey, variantSuffix("card", { maxEdge: 1024 }));

    const provider = createInMemoryFileProvider();
    await provider.write(originalKey, new Uint8Array([1]));
    await provider.write(derivedKey, new Uint8Array([2]));

    await seedFileRefWithKey(uuid(502), TENANT_A, userId, originalKey);

    await fileRefDeleteHook(
      {
        db: createTenantDb(stack.db, TENANT_A, "tenant"),
        registry: stack.registry,
        tenantId: TENANT_A,
        userId,
        buildStorageProvider: async () => provider,
      },
      "anonymize",
    );

    expect(await provider.exists(originalKey)).toBe(true);
    expect(await provider.exists(derivedKey)).toBe(true);
  });

  test("a provider.list() failure (e.g. missing s3:ListBucket) throws a wrapped, actionable error instead of a raw provider error", async () => {
    const userId = "user-list-fails-derivatives";
    const originalKey = `derivatives-test/${uuid(503)}.jpg`;

    const base = createInMemoryFileProvider();
    await base.write(originalKey, new Uint8Array([1]));
    const provider = {
      ...base,
      list: async () => {
        throw new Error("AccessDenied");
      },
    };

    await seedFileRefWithKey(uuid(503), TENANT_A, userId, originalKey);

    await expect(
      fileRefDeleteHook(
        {
          db: createTenantDb(stack.db, TENANT_A, "tenant"),
          registry: stack.registry,
          tenantId: TENANT_A,
          userId,
          buildStorageProvider: async () => provider,
        },
        "delete",
      ),
    ).rejects.toThrow(/list permission/);
  });
});
