import type { SeedFn } from "@cosmicdrift/kumiko-dev-server";
import { buildEntityTable, createTenantDb, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { createEntityExecutor, createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFileRefFromBytes,
  createTenantFileContext,
} from "@cosmicdrift/kumiko-framework/files";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";

import { demoEntity } from "../features/demo/feature";
import { inspectionEntity } from "../features/examples/feature";

// Gives the list view real rows with status/flag variety. price (money)
// stays empty — the money input shows in the edit screen, in the seed we leave
// it out to avoid depending on the money payload shape.
const STATUSES = ["draft", "review", "published", "archived"] as const;

// Fixed across boots (unlike the framework-minted ids for every other seed
// row) so the "edit-existing" screenshot scenario has a stable /item-edit/
// <id> URL to hit — the DB is ephemeral per boot, so a captured id would
// otherwise change every run.
export const FIRST_STYLEGUIDE_ITEM_ID = "00000000-0000-4000-8000-0000000000f1";

export const FIRST_STYLEGUIDE_INSPECTION_ID = "00000000-0000-4000-8000-0000000000f2";

const demoItemTable = buildEntityTable("item", demoEntity);

export const seedStyleguideItems: SeedFn = async (stack) => {
  // The first row has a fixed id, so its presence means a persistent dev DB was seeded already.
  if (await fetchOne(stack.db, demoItemTable, { id: FIRST_STYLEGUIDE_ITEM_ID })) return;

  // Bypass the write-handler HTTP path for the first row — its schema has
  // no `id` field (buildInsertSchema only exposes entity fields), so an
  // explicit id would be silently stripped before reaching the executor.
  // Calling the executor directly is the framework's documented "seed
  // pattern" for a caller-chosen aggregate id (event-store-executor-write.ts).
  const { executor } = createEntityExecutor("item", demoEntity);
  const tenantDb = createTenantDb({ db: stack.db, tenantId: TestUsers.admin.tenantId });

  for (let i = 0; i < 8; i++) {
    const payload = {
      ...(i === 0 && { id: FIRST_STYLEGUIDE_ITEM_ID }),
      name: `Demo item #${i + 1}`,
      description: i % 2 === 0 ? `Notes for demo item ${i + 1}` : "",
      quantity: (i % 5) + 1,
      rating: (i % 3) + 1,
      isActive: i % 4 !== 0,
      status: STATUSES[i % STATUSES.length],
      publishedAt: "2026-06-30",
    };
    if (i === 0) {
      const res = await executor.create(payload, TestUsers.admin, tenantDb);
      if (!res.isSuccess) {
        // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
        console.error(`[seed] styleguide item ${i + 1} failed:`, res.error);
        return;
      }
      continue;
    }
    const res = await stack.http.write("styleguide:write:item:create", payload, TestUsers.admin);
    if (!res.ok) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error(`[seed] styleguide item ${i + 1} failed:`, await res.text());
      return;
    }
  }
};

const inspectionTable = buildEntityTable("inspection", inspectionEntity);

// 1x1 PNG, enough for the thumbnail chain; the bytes only need to be a valid image.
const SEED_PHOTO_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

// Fixed id for the inspection-checklist screenshot scenarios. Created through the executor like
// the first demo item. Photos are real file refs attached to checkpoints.photos, created
// server-side the way POST /files would (a not_ok checkpoint requires a photo).
export const seedStyleguideInspection: SeedFn = async (stack) => {
  if (await fetchOne(stack.db, inspectionTable, { id: FIRST_STYLEGUIDE_INSPECTION_ID })) return;
  const tenantId = TestUsers.admin.tenantId;
  const tenantDb = createTenantDb({ db: stack.db, tenantId });
  const resolver = stack.context._fileProviderResolver;
  const files = resolver ? createTenantFileContext(resolver, tenantId) : stack.context.files;

  const photoIds: string[] = [];
  for (const fileName of ["hose.png", "bearing.png"]) {
    const photo = await createFileRefFromBytes(
      {
        db: tenantDb,
        services: { files },
        registry: stack.registry,
        user: createSystemUser(tenantId),
      },
      {
        fileName,
        mimeType: "image/png",
        data: SEED_PHOTO_PNG,
        attachTo: {
          entityType: "inspection",
          fieldName: "checkpoints",
          subField: "photos",
          entityId: FIRST_STYLEGUIDE_INSPECTION_ID,
        },
      },
    );
    if (!photo.isSuccess) {
      // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
      console.error("[seed] styleguide inspection photo failed:", photo.error);
      return;
    }
    photoIds.push(photo.data.id);
  }

  const { executor } = createEntityExecutor("inspection", inspectionEntity);
  const res = await executor.create(
    {
      id: FIRST_STYLEGUIDE_INSPECTION_ID,
      measuringDevice: "Torque wrench TW-200",
      checkpoints: [
        { label: "Guard fitted", kind: "check", result: "ok" },
        {
          label: "Hydraulic hose intact",
          kind: "check",
          result: "not_ok",
          finding: "Hose chafed at the clamp, replace before next shift.",
          photos: [photoIds[0]],
        },
        {
          label: "Bolt torque (Nm)",
          kind: "measurement",
          min: 180,
          max: 200,
          measured: 190,
          result: "ok",
        },
        {
          label: "Bearing play (mm)",
          kind: "measurement",
          min: 0.05,
          max: 0.2,
          measured: 0.31,
          result: "not_ok",
          finding: "Play above tolerance, re-measure after re-seating.",
          photos: [photoIds[1]],
        },
      ],
      continuedOperation: "with_condition",
      condition: "Operate at reduced load until the hose is replaced.",
    },
    TestUsers.admin,
    tenantDb,
  );
  if (!res.isSuccess) {
    // biome-ignore lint/suspicious/noConsole: dev-seed surfaces failures in the runner log
    console.error("[seed] styleguide inspection failed:", res.error);
  }
};
