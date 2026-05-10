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

import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createFilesFeature } from "../../files";
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

const features = [
  createUserFeature(),
  createFilesFeature(),
  createDataRetentionFeature(),
  createComplianceProfilesFeature(),
  createUserDataRightsFeature(),
  createUserDataRightsDefaultsFeature(),
];

beforeAll(async () => {
  stack = await setupTestStack({ features });

  // userEntity via Framework-Helper migrieren (kennt softDelete +
  // automatische tenant_id-Spalte — die manuell-CREATE wuerde mit
  // Drizzle-Generated-Queries kollidieren).
  await unsafeCreateEntityTable(stack.db, userEntity);

  // file_refs ist framework-pgTable (nicht entity-getrieben, S1.5 hat
  // die Schema-Sicht ohne buildDrizzleTable-Auto-Generation). Manuelle
  // CREATE matched die Spalten aus framework/src/files/file-ref-table.ts
  await stack.db.execute(sql`
    CREATE TABLE IF NOT EXISTS file_refs (
      id UUID PRIMARY KEY,
      tenant_id UUID NOT NULL,
      storage_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      field_name TEXT,
      inserted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
      inserted_by_id TEXT
    )
  `);
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
  const SYSTEM_TENANT = "00000000-0000-4000-8000-000000000001";
  await stack.db
    .insert(userTable)
    .values({
      id,
      tenantId: SYSTEM_TENANT,
      email: `user-${id}@example.com`,
      passwordHash: "hashed-password",
      displayName: `User ${id}`,
      locale: "de",
      emailVerified: true,
      roles: '["Member"]',
      status: USER_STATUS.Active,
      ...overrides,
    })
    .onConflictDoNothing();
}

async function seedFileRef(
  id: string,
  tenantId: string,
  insertedById: string | null,
  fileName: string,
): Promise<void> {
  await stack.db.execute(sql`
    INSERT INTO file_refs (id, tenant_id, storage_key, file_name, mime_type, size, inserted_by_id)
    VALUES (${id}, ${tenantId}, ${`storage/${id}`}, ${fileName}, 'application/pdf', 1024, ${insertedById})
    ON CONFLICT (id) DO NOTHING
  `);
}

async function fetchUser(id: string) {
  const result = await stack.db.execute(sql`
    SELECT id, email, display_name, password_hash, status, deleted_at
    FROM read_users WHERE id = ${id}
  `);
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
      ? await stack.db.execute(sql`SELECT * FROM file_refs WHERE tenant_id = ${tenantId}`)
      : insertedById === null
        ? await stack.db.execute(
            sql`SELECT * FROM file_refs WHERE tenant_id = ${tenantId} AND inserted_by_id IS NULL`,
          )
        : await stack.db.execute(
            sql`SELECT * FROM file_refs WHERE tenant_id = ${tenantId} AND inserted_by_id = ${insertedById}`,
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
      db: stack.db,
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
      db: stack.db,
      tenantId: TENANT_A,
      userId: uuid(1002),
    });
    expect(result).toBeNull();
  });
});

describe("S2.H1 :: userDeleteHook", () => {
  test('strategy="delete" → softDelete + email/displayName anonymisiert + status=deleted', async () => {
    await seedUser(uuid(1003));

    await userDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: uuid(1003) }, "delete");

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

    await userDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: uuid(1004) }, "anonymize");

    const row = await fetchUser(uuid(1004));
    if (!row) throw new Error("row should exist");
    expect(row.email).toContain("anonymized.invalid");
    expect(row.display_name).toBe(USER_ANONYMIZED_DISPLAY_NAME);
    expect(row.status).toBe(USER_STATUS.Active); // NICHT auf deleted
    expect(row.deleted_at).toBeNull(); // KEIN softDelete
  });

  test("idempotent: zweiter delete-Call crasht nicht UND State bleibt korrekt deleted", async () => {
    await seedUser(uuid(1005));

    await userDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: uuid(1005) }, "delete");
    const afterFirst = await fetchUser(uuid(1005));
    if (!afterFirst) throw new Error("user should exist after first delete");

    // Zweiter Call: kein Crash + State unverändert
    await expect(
      userDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: uuid(1005) }, "delete"),
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
      db: stack.db,
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
      db: stack.db,
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
      { db: stack.db, tenantId: TENANT_A, userId: "user-delete-files" },
      "delete",
    );

    const remaining = await fetchFileRefs(TENANT_A, "user-delete-files");
    expect(remaining).toHaveLength(0);
  });

  test('strategy="anonymize" → insertedById=null, Files bleiben', async () => {
    await seedFileRef(uuid(203), TENANT_A, "user-anon-files", "shared.pdf");

    await fileRefDeleteHook(
      { db: stack.db, tenantId: TENANT_A, userId: "user-anon-files" },
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
    await fileRefDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: "shared-user" }, "delete");

    const aRemaining = await fetchFileRefs(TENANT_A, "shared-user");
    const bRemaining = await fetchFileRefs(TENANT_B, "shared-user");

    expect(aRemaining).toHaveLength(0); // Tenant A: weg
    expect(bRemaining).toHaveLength(1); // Tenant B: unangetastet
    expect(bRemaining[0]?.file_name).toBe("tenantB.pdf");
  });

  test("idempotent: zweiter delete-Call crasht nicht UND DB-State bleibt 0 Files", async () => {
    await seedFileRef(uuid(401), TENANT_A, "user-idem-files", "f.pdf");

    await fileRefDeleteHook(
      { db: stack.db, tenantId: TENANT_A, userId: "user-idem-files" },
      "delete",
    );
    const afterFirst = await fetchFileRefs(TENANT_A, "user-idem-files");
    expect(afterFirst).toHaveLength(0);

    // Zweiter Call: kein Crash + State weiter 0 Files
    await expect(
      fileRefDeleteHook({ db: stack.db, tenantId: TENANT_A, userId: "user-idem-files" }, "delete"),
    ).resolves.toBeUndefined();
    const afterSecond = await fetchFileRefs(TENANT_A, "user-idem-files");
    expect(afterSecond).toHaveLength(0);
  });
});
