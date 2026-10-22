import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTemplateResolverFeature,
  TEXT_BLOCK_KIND,
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { type LegalContentBlock, legalContentSeed } from "../seed.ts";

const BLOCKS: readonly LegalContentBlock[] = [
  { slug: "terms", locale: "en", title: "Terms", content: "Terms text." },
  { slug: "privacy", locale: "en", title: "Privacy", content: "Privacy text." },
];

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function readBlock(slug: string): Promise<TemplateResourceRow> {
  const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind: TEXT_BLOCK_KIND,
    locale: "en",
  });
  if (!row) throw new Error(`block ${slug} was not seeded`);
  return row;
}

describe("legalContentSeed folder option", () => {
  test("sets the folder, leaves a second identical run untouched and keeps it without the option", async () => {
    await legalContentSeed({ blocks: BLOCKS }, { folder: "legal" })({ db: stack.db });
    const first = await readBlock("terms");
    expect(first.folder).toBe("legal");

    await legalContentSeed({ blocks: BLOCKS }, { folder: "legal" })({ db: stack.db });
    expect((await readBlock("terms")).version).toBe(first.version);

    const revised = BLOCKS.map((block) => ({ ...block, content: `${block.content} Revised.` }));
    await legalContentSeed({ blocks: revised })({ db: stack.db });
    const kept = await readBlock("terms");
    expect(kept.content).toBe("Terms text. Revised.");
    expect(kept.folder).toBe("legal");
    expect((await readBlock("privacy")).folder).toBe("legal");
  });

  test("a block created without a folder stays at the root", async () => {
    await legalContentSeed({
      blocks: [{ slug: "imprint", locale: "en", title: "Imprint", content: "Imprint text." }],
    })({ db: stack.db });
    expect((await readBlock("imprint")).folder).toBeNull();
  });
});
