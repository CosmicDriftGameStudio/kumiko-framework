// A system mail-layout bundle with a `logo` resource is seedable at boot through the seed
// dispatcher: the file lands in the system tenant's file space and a re-seed writes nothing.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { patchFileInstanceofForBunTest } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.js";
import { parseLinkedResourceEntries } from "../linked-resources.js";
import { seedSystemTemplateBundle } from "../seeding.js";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.js";
import type { TemplateBundle } from "../template-bundle.js";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const LAYOUT =
  '<div data-header><img data-resource="logo"></div><div data-content></div><div data-signature><p>Gruss</p></div><div data-footer><p>Impressum</p></div>';

const layoutBundle: TemplateBundle = {
  slug: "seeded-brand-layout",
  kind: "mail-layout",
  contentFormat: "html",
  locales: { de: { body: LAYOUT }, en: { body: LAYOUT } },
  resources: { logo: { fileName: "logo.png", contentType: "image/png", base64: PNG_BASE64 } },
  pdfAttachments: {},
};

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [createFilesFeature(), createTemplateResolverFeature()],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function systemRow(locale: string): Promise<TemplateResourceRow | undefined> {
  return fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug: layoutBundle.slug,
    kind: layoutBundle.kind,
    locale,
  });
}

describe("seedSystemTemplateBundle with resources", () => {
  test("without a dispatcher it fails and names opts.dispatcher", async () => {
    await expect(seedSystemTemplateBundle(stack.db, layoutBundle)).rejects.toThrow(
      "pass opts.dispatcher",
    );
  });

  test("seeds the layout with its logo and a second run writes nothing", async () => {
    const first = await seedSystemTemplateBundle(stack.db, layoutBundle, {
      dispatcher: stack.dispatcher,
    });
    expect(Object.keys(first.ids).sort()).toEqual(["de", "en"]);

    const row = await systemRow("de");
    expect(row?.scope).toBe("system");
    const logoLink = parseLinkedResourceEntries(row?.linkedResources ?? null)["logo"];
    expect(typeof logoLink).toBe("string");
    const fileRefs = await selectMany(stack.db, fileRefsTable, { tenantId: SYSTEM_TENANT_ID });
    expect(fileRefs.map((ref) => ref.id)).toContain(logoLink);

    const versionBefore = { de: row?.version, en: (await systemRow("en"))?.version };
    const fileRefCountBefore = fileRefs.length;

    const second = await seedSystemTemplateBundle(stack.db, layoutBundle, {
      dispatcher: stack.dispatcher,
    });
    expect(second.ids).toEqual(first.ids);
    expect({ de: (await systemRow("de"))?.version, en: (await systemRow("en"))?.version }).toEqual(
      versionBefore,
    );
    expect((await selectMany(stack.db, fileRefsTable, { tenantId: SYSTEM_TENANT_ID })).length).toBe(
      fileRefCountBefore,
    );
  });
});
