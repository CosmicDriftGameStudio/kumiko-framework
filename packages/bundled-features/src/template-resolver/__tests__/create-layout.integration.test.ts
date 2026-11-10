// create-layout runs through the real write pipeline; nothing is mocked.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import { TENANT_LAYOUT_SLUG_PREFIX } from "../web/constants.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const LOCALE = "de";
const NEW_NAME = "musterbrief";
const NEW_LAYOUT = `${TENANT_LAYOUT_SLUG_PREFIX}${NEW_NAME}`;
const SYSTEM_LAYOUT = "sys-layout";
const LETTER = "musterbrief-text";
const WELCOME_MAIL = "welcome";
const SECOND_LETTER = "zweiter-brief";

const TENANT_EDITABLE = [
  ...tenantEditableTemplates(["document-pdf"], [LETTER]),
  { kind: "document-pdf" as const, slug: SECOND_LETTER, access: { roles: ["SecondLetterEditor"] } },
  { kind: "mail" as const, slug: WELCOME_MAIL, access: { roles: ["MailAdmin"] } },
];

// Edits every PDF template, so it may build tenant layouts.
const admin = createTestUser({
  id: 1,
  roles: ["TenantAdmin", "SecondLetterEditor"],
  tenantId: testTenantId(1),
});
const firstLetterOnly = createTestUser({
  id: 4,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(1),
});
const mailAdmin = createTestUser({ id: 2, roles: ["MailAdmin"], tenantId: testTenantId(1) });

let stack: TestStack;

type Created = {
  slug: string;
  locale: string;
  kind: string;
  base: { scope: string; version: number };
};
type Blocks = {
  base: Created["base"];
  status: string;
  meta: Record<string, unknown>;
  blocks: { text?: string }[];
};

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
    ],
    extraContext: () => ({ configResolver: createConfigResolver() }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: SYSTEM_LAYOUT,
      kind: "pdf-layout",
      locale: LOCALE,
      content: "<div data-content></div>",
      contentFormat: "html",
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    {
      slug: LETTER,
      kind: "document-pdf",
      locale: LOCALE,
      content: "<p>Guten Tag</p>",
      contentFormat: "html",
      variableSchema: {},
    },
    admin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

const create = (name: string, as = admin) =>
  stack.http.write(
    TemplateResolverHandlers.createLayout,
    { name, title: "Musterbrief", locale: LOCALE },
    as,
  );

describe("template-resolver :: create-layout", () => {
  test("creates a tenant draft with empty regions and the standard look, then patch-draft fills it and a template points at it", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createLayout,
      { name: NEW_NAME, title: "Musterbrief", locale: LOCALE },
      admin,
    );
    expect(created).toMatchObject({
      slug: NEW_LAYOUT,
      kind: "pdf-layout",
      base: { scope: "tenant" },
    });

    const header = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      { slug: NEW_LAYOUT, kind: "pdf-layout", region: "header", locale: LOCALE },
      admin,
    );
    expect(header.blocks.map((block) => block.text ?? "")).toEqual([""]);
    expect(header.status).toBe("draft");
    expect(header.meta).toMatchObject({ fontFamily: "arial", tableStyle: "plain" });
    expect(header.base).toEqual(created.base);

    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: NEW_LAYOUT,
        kind: "pdf-layout",
        region: "header",
        locale: LOCALE,
        base: created.base,
        ops: [
          {
            op: "replaceBody",
            blocks: [
              { type: "paragraph", align: "center", text: "Musterfirma GmbH, Musterstraße 1" },
            ],
          },
        ],
      },
      admin,
    );
    const filled = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      { slug: NEW_LAYOUT, kind: "pdf-layout", region: "header", locale: LOCALE },
      admin,
    );
    expect(filled.blocks[0]?.text).toBe("Musterfirma GmbH, Musterstraße 1");

    await stack.http.writeOk(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: NEW_LAYOUT, kind: "pdf-layout", locale: LOCALE }] },
      admin,
    );
    const letter = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      { slug: LETTER, kind: "document-pdf", locale: LOCALE },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: LETTER,
        kind: "document-pdf",
        locale: LOCALE,
        base: letter.base,
        ops: [{ op: "setMeta", meta: { layoutSlug: NEW_LAYOUT } }],
      },
      admin,
    );
    const pointed = await stack.http.queryOk<Blocks>(
      TemplateResolverQueries.documentBlocks,
      { slug: LETTER, kind: "document-pdf", locale: LOCALE },
      admin,
    );
    expect(pointed.meta["layoutSlug"]).toBe(NEW_LAYOUT);
  });

  test("a slug the tenant already has is refused with layout_exists", async () => {
    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.createLayout,
        { name: NEW_NAME, title: "Nochmal", locale: LOCALE },
        admin,
      ),
      "layout_exists",
    );
  });

  test("a system layout cannot take a slug from the tenant namespace", async () => {
    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.upsertSystem,
        {
          slug: `${TENANT_LAYOUT_SLUG_PREFIX}sys`,
          kind: "pdf-layout",
          locale: LOCALE,
          content: "<div data-content></div>",
          contentFormat: "html",
          variableSchema: {},
          linkedResources: {},
        },
        TestUsers.systemAdmin,
      ),
      "reserved_layout_slug",
    );
  });

  test("a layout outside the tenant namespace stays locked", async () => {
    const res = await stack.http.write(
      TemplateResolverHandlers.patchDraft,
      {
        slug: SYSTEM_LAYOUT,
        kind: "pdf-layout",
        region: "header",
        locale: LOCALE,
        base: { scope: "system", version: 1 },
        ops: [{ op: "replaceBody", blocks: [{ type: "paragraph", text: "x" }] }],
      },
      admin,
    );
    expect(res.status).toBe(403);
  });

  test("the right on one PDF template is not enough: create-layout and apply-layout all are refused", async () => {
    expect((await create("only-first", firstLetterOnly)).status).toBe(403);
    const applied = await stack.http.write(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: NEW_LAYOUT, target: { mode: "all" } },
      firstLetterOnly,
    );
    expect(applied.status).toBe(403);
  });

  test("a TenantAdmin without the right to edit a PDF template cannot create layouts", async () => {
    expect((await create("mail-only", mailAdmin)).status).toBe(403);
    const plain = createTestUser({ id: 3, roles: ["User"], tenantId: testTenantId(1) });
    expect((await create("another-layout", plain)).status).toBe(403);
  });
});
