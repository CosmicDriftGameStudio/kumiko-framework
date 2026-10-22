import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import sharp from "sharp";
import { createTemplateResolverApi } from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import {
  collectionHandlerName,
  collectionQueryName,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../web/qualified-names.ts";

const NOT_EDITABLE_REASON = "template_not_tenant_editable";
const OPEN_SLUG = "policy:notify:open";
const CLOSED_SLUG = "policy:notify:closed";
const UNKNOWN_ID = "00000000-0000-4000-8000-0000000000cc";
const OPEN_BLOCK_SLUG = "policy-block-open";

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const plainUser = createTestUser({ id: 4, roles: ["User"], tenantId: testTenantId(10) });

function mailPayload(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    kind: "mail" as const,
    locale: "de",
    content: "<p>Hallo</p>",
    contentFormat: "html" as const,
    meta: { subject: "Hallo" },
    variableSchema: {},
    ...extra,
  };
}

async function upsertAs(
  stack: TestStack,
  user: typeof tenantAdmin,
  slug: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    mailPayload(slug, extra),
    user,
  );
  return created.id;
}

describe("template edit policy :: no tenantEditable (default)", () => {
  let stack: TestStack;
  let systemOverrideId: string;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    systemOverrideId = await upsertAs(stack, systemAdmin, OPEN_SLUG, {
      tenantIdOverride: tenantAdmin.tenantId,
      status: "active",
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a TenantAdmin is refused on every write path", async () => {
    const bundle = {
      slug: OPEN_SLUG,
      kind: "mail",
      contentFormat: "html",
      locales: { de: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } },
    };
    const attempts: readonly [string, Record<string, unknown>][] = [
      [TemplateResolverHandlers.upsertTenant, mailPayload(OPEN_SLUG)],
      [TemplateResolverHandlers.publish, { id: systemOverrideId }],
      [TemplateResolverHandlers.archive, { id: systemOverrideId }],
      [TemplateResolverHandlers.discardDraft, { id: systemOverrideId }],
      [TemplateResolverHandlers.resetToSystem, { id: systemOverrideId }],
      [TemplateResolverHandlers.importBundle, { bundle, overwrite: true }],
      [
        TemplateResolverHandlers.set,
        { slug: "policy-block", locale: "de", title: "Block", content: "x" },
      ],
      [
        TemplateResolverHandlers.copyLocale,
        { slug: OPEN_SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      ],
      [
        TemplateResolverHandlers.resourceUpload,
        {
          sourceFileRefId: "00000000-0000-4000-8000-0000000000aa",
          templateId: systemOverrideId,
          key: "logo",
        },
      ],
      [TemplateResolverHandlers.resourceRemove, { templateId: systemOverrideId, key: "logo" }],
      [TemplateResolverHandlers.sendTest, { slug: OPEN_SLUG, locale: "de" }],
    ];
    for (const [handler, payload] of attempts) {
      const error = await stack.http.writeErr(handler, payload, tenantAdmin);
      expect({ handler, code: error.code, status: error.httpStatus }).toEqual({
        handler,
        code: "access_denied",
        status: 403,
      });
    }
  });

  test("a SystemAdmin may write", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload(CLOSED_SLUG),
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.publishSystem,
      { id: created.id },
      systemAdmin,
    );
  });

  test("a collection mounted without access is SystemAdmin only", async () => {
    const withCollection = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          collections: [
            { id: "closed-prompts", kind: "ai-prompt", nav: { label: "x:nav.prompts" } },
          ],
        }),
      ],
    });
    try {
      await unsafeCreateEntityTable(withCollection.db, templateResourceEntity);
      const listName = collectionQueryName("closed-prompts", "list");
      const setName = collectionHandlerName("closed-prompts");
      const entry = { slug: "greeting", locale: "de", title: "Hallo", content: "x" };

      const listDenied = await withCollection.http.queryErr(listName, {}, tenantAdmin);
      expect(listDenied.httpStatus).toBe(403);
      const setDenied = await withCollection.http.writeErr(setName, entry, tenantAdmin);
      expect(setDenied.httpStatus).toBe(403);

      await withCollection.http.writeOk(setName, entry, systemAdmin);
      const listed = await withCollection.http.queryOk<{ blocks: readonly { slug: string }[] }>(
        listName,
        {},
        systemAdmin,
      );
      expect(listed.blocks.map((block) => block.slug)).toContain("greeting");
    } finally {
      await withCollection.cleanup();
    }
  });

  test("a collection with access TenantAdmin lets a TenantAdmin list and set", async () => {
    const opened = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          collections: [
            {
              id: "open-prompts",
              kind: "ai-prompt",
              access: { roles: ["TenantAdmin"] },
              nav: { label: "x:nav.prompts" },
            },
          ],
        }),
      ],
    });
    try {
      await unsafeCreateEntityTable(opened.db, templateResourceEntity);
      await opened.http.writeOk(
        collectionHandlerName("open-prompts"),
        { slug: "greeting", locale: "de", title: "Hallo", content: "x" },
        tenantAdmin,
      );
      await opened.http.queryOk(collectionQueryName("open-prompts", "list"), {}, tenantAdmin);
    } finally {
      await opened.cleanup();
    }
  });
});

describe("template edit policy :: tenantEditable for one mail slug", () => {
  const provider = createInMemoryFileProvider();
  let stack: TestStack;
  let closedRowId: string;

  beforeAll(async () => {
    patchFileInstanceofForBunTest();
    stack = await setupTestStack({
      features: [
        createFilesFeature(),
        createTemplateResolverFeature({
          tenantEditable: [
            { kind: "mail", slug: OPEN_SLUG, access: { roles: ["TenantAdmin"] } },
            { kind: "text-block", slug: OPEN_BLOCK_SLUG, access: { roles: ["TenantAdmin"] } },
          ],
        }),
      ],
      files: { storageProvider: provider },
    });
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    for (const slug of [OPEN_SLUG, CLOSED_SLUG]) {
      await stack.http.writeOk(
        TemplateResolverHandlers.upsertSystem,
        mailPayload(slug, { status: "active" }),
        systemAdmin,
      );
    }
    closedRowId = await upsertAs(stack, systemAdmin, CLOSED_SLUG, {
      tenantIdOverride: tenantAdmin.tenantId,
      status: "active",
      content: "<p>Vom Admin der Plattform</p>",
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function uploadLogo(): Promise<string> {
    const logo = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    form.append("file", new File([logo], "logo.png", { type: "image/png" }));
    const { body, contentType } = await buildMultipartBody(form);
    const res = await stack.app.request("/api/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await stack.jwt.sign(tenantAdmin)}`,
        "Content-Type": contentType,
      },
      body,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  test("a TenantAdmin runs the full lifecycle on the unlocked slug", async () => {
    const id = await upsertAs(stack, tenantAdmin, OPEN_SLUG);
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id }, tenantAdmin);

    const blocks = await stack.http.queryOk<{
      base: { scope: "tenant" | "system"; version: number };
    }>(
      TemplateResolverQueries.documentBlocks,
      { slug: OPEN_SLUG, kind: "mail", locale: "de" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: OPEN_SLUG,
        kind: "mail",
        locale: "de",
        base: blocks.base,
        ops: [{ op: "setMeta", meta: { subject: "Neu" } }],
      },
      tenantAdmin,
    );

    await upsertAs(stack, tenantAdmin, OPEN_SLUG, { content: "<p>Entwurf</p>" });
    await stack.http.writeOk(TemplateResolverHandlers.discardDraft, { id }, tenantAdmin);

    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      { slug: OPEN_SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      tenantAdmin,
    );

    const sourceFileRefId = await uploadLogo();
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceUpload,
      { sourceFileRefId, templateId: id, key: "logo" },
      tenantAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.resourceRemove,
      { templateId: id, key: "logo" },
      tenantAdmin,
    );

    await stack.http.writeOk(TemplateResolverHandlers.archive, { id }, tenantAdmin);
    await stack.http.writeOk(TemplateResolverHandlers.resetToSystem, { id }, tenantAdmin);
  });

  test("another slug of the same kind is refused with the not-editable reason", async () => {
    const bundle = {
      slug: CLOSED_SLUG,
      kind: "mail",
      contentFormat: "html",
      locales: { de: { body: "<p>Hallo</p>", meta: { subject: "Hallo" } } },
    };
    const attempts: readonly [string, Record<string, unknown>][] = [
      [TemplateResolverHandlers.upsertTenant, mailPayload(CLOSED_SLUG)],
      [TemplateResolverHandlers.publish, { id: closedRowId }],
      [TemplateResolverHandlers.archive, { id: closedRowId }],
      [TemplateResolverHandlers.discardDraft, { id: closedRowId }],
      [TemplateResolverHandlers.resetToSystem, { id: closedRowId }],
      [TemplateResolverHandlers.importBundle, { bundle, overwrite: true }],
      [
        TemplateResolverHandlers.copyLocale,
        { slug: CLOSED_SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      ],
      [
        TemplateResolverHandlers.patchDraft,
        {
          slug: CLOSED_SLUG,
          kind: "mail",
          locale: "de",
          base: { scope: "tenant", version: 1 },
          ops: [{ op: "setMeta", meta: { subject: "Neu" } }],
        },
      ],
      [
        TemplateResolverHandlers.resourceUpload,
        {
          sourceFileRefId: "00000000-0000-4000-8000-0000000000aa",
          templateId: closedRowId,
          key: "logo",
        },
      ],
      [TemplateResolverHandlers.resourceRemove, { templateId: closedRowId, key: "logo" }],
      [
        TemplateResolverHandlers.resourceLinkPdf,
        {
          templateId: closedRowId,
          key: "invoice",
          templateSlug: "policy:pdf",
          fileName: "invoice.pdf",
        },
      ],
      [
        TemplateResolverHandlers.resourceRemove,
        { templateId: "00000000-0000-4000-8000-0000000000bb", key: "logo" },
      ],
      [TemplateResolverHandlers.sendTest, { slug: CLOSED_SLUG, locale: "de" }],
      [TemplateResolverHandlers.publish, { id: UNKNOWN_ID }],
      [TemplateResolverHandlers.archive, { id: UNKNOWN_ID }],
      [TemplateResolverHandlers.discardDraft, { id: UNKNOWN_ID }],
      [TemplateResolverHandlers.resetToSystem, { id: UNKNOWN_ID }],
    ];
    for (const [handler, payload] of attempts) {
      const error = await stack.http.writeErr(handler, payload, tenantAdmin);
      expect({
        handler,
        code: error.code,
        status: error.httpStatus,
        reason: (error.details as { reason?: string } | undefined)?.reason,
      }).toEqual({ handler, code: "access_denied", status: 403, reason: NOT_EDITABLE_REASON });
    }
  });

  test("a SystemAdmin gets not_found on an unknown id, no existence probe for a TenantAdmin", async () => {
    for (const handler of [
      TemplateResolverHandlers.publish,
      TemplateResolverHandlers.archive,
      TemplateResolverHandlers.discardDraft,
      TemplateResolverHandlers.resetToSystem,
    ]) {
      const error = await stack.http.writeErr(handler, { id: UNKNOWN_ID }, systemAdmin);
      expect({ handler, code: error.code, status: error.httpStatus }).toEqual({
        handler,
        code: "not_found",
        status: 404,
      });
    }
  });

  test("the test mail is part of editing: the unlocked slug passes the policy", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.sendTest,
      { slug: OPEN_SLUG, locale: "de" },
      tenantAdmin,
    );
    // No mail channel is mounted here, so the send stops after the policy check.
    expect(error.httpStatus).not.toBe(403);
  });

  test("a bundle carries one template, so a closed slug is refused and nothing is written", async () => {
    const before = await stack.http.queryOk<readonly { slug: string }[]>(
      TemplateResolverQueries.list,
      { kind: "mail" },
      tenantAdmin,
    );
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      {
        bundle: {
          slug: CLOSED_SLUG,
          kind: "mail",
          contentFormat: "html",
          locales: { fr: { body: "<p>Salut</p>", meta: { subject: "Salut" } } },
        },
        overwrite: true,
      },
      tenantAdmin,
    );
    expect(error.httpStatus).toBe(403);
    const after = await stack.http.queryOk<readonly { slug: string }[]>(
      TemplateResolverQueries.list,
      { kind: "mail" },
      tenantAdmin,
    );
    expect(after).toHaveLength(before.length);
  });

  test("a TenantAdmin never writes cross-tenant, even on the unlocked slug", async () => {
    const foreignTenantId = testTenantId(99);
    const sourceFileRefId = await uploadLogo();
    const ownId = await upsertAs(stack, tenantAdmin, OPEN_SLUG);
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: OPEN_BLOCK_SLUG, locale: "de", title: "Block", content: "x" },
      tenantAdmin,
    );
    for (const tenantIdOverride of [foreignTenantId, SYSTEM_TENANT_ID]) {
      const attempts: readonly [string, Record<string, unknown>][] = [
        [TemplateResolverHandlers.upsertTenant, mailPayload(OPEN_SLUG, { tenantIdOverride })],
        [
          TemplateResolverHandlers.set,
          {
            slug: OPEN_BLOCK_SLUG,
            locale: "de",
            title: "Block",
            content: "x",
            tenantIdOverride,
          },
        ],
        [
          TemplateResolverHandlers.resourceUpload,
          { sourceFileRefId, templateId: ownId, key: "logo", tenantIdOverride },
        ],
      ];
      for (const [handler, payload] of attempts) {
        const error = await stack.http.writeErr(handler, payload, tenantAdmin);
        expect({ handler, tenantIdOverride, status: error.httpStatus }).toEqual({
          handler,
          tenantIdOverride,
          status: 403,
        });
      }
    }
  });

  test("a SystemAdmin still edits the slug that is not unlocked", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      mailPayload(CLOSED_SLUG, {
        tenantIdOverride: tenantAdmin.tenantId,
        content: "<p>Nochmal vom Admin der Plattform</p>",
        status: "active",
      }),
      systemAdmin,
    );
  });

  test("the unlocked edit is delivered, the existing override of the locked template is not", async () => {
    const api = createTemplateResolverApi(stack.db, stack.registry);
    const openId = await upsertAs(stack, tenantAdmin, OPEN_SLUG, {
      content: "<p>Vom Tenant</p>",
      status: "active",
    });
    expect(openId).toBeDefined();
    const open = await api.resolveTemplate({
      tenantId: tenantAdmin.tenantId,
      slug: OPEN_SLUG,
      kind: "mail",
      locale: "de",
    });
    expect(open.scope).toBe("tenant");
    expect(open.content).toContain("Vom Tenant");

    const closed = await api.resolveTemplate({
      tenantId: tenantAdmin.tenantId,
      slug: CLOSED_SLUG,
      kind: "mail",
      locale: "de",
    });
    expect(closed.scope).toBe("system");
    expect(closed.content).not.toContain("Admin der Plattform");
  });

  test("find-by-id and list hide the locked override from a TenantAdmin and a user", async () => {
    for (const reader of [tenantAdmin, plainUser]) {
      const found = await stack.http.queryOk<{ slug: string } | null>(
        TemplateResolverQueries.findById,
        { id: closedRowId },
        reader,
      );
      expect(found).toBeNull();
      const rows = await stack.http.queryOk<readonly { id: string }[]>(
        TemplateResolverQueries.list,
        { kind: "mail" },
        reader,
      );
      expect(rows.map((row) => row.id)).not.toContain(closedRowId);
    }
  });

  test("the overview shows a TenantAdmin only the unlocked template and a SystemAdmin all", async () => {
    const slugsOf = async (user: typeof tenantAdmin): Promise<string[]> => {
      const response = await stack.http.queryOk<{
        rows: readonly { slug: string; origin: string }[];
      }>(TemplateResolverQueries.overview, {}, user);
      return response.rows.filter((row) => row.slug.startsWith("policy:")).map((row) => row.slug);
    };
    expect(await slugsOf(tenantAdmin)).toEqual([OPEN_SLUG]);
    expect(await slugsOf(systemAdmin)).toEqual(expect.arrayContaining([OPEN_SLUG, CLOSED_SLUG]));
  });
});

describe("template edit policy :: read handlers follow the tenantEditable roles", () => {
  const editor = createTestUser({ id: 5, roles: ["Editor"], tenantId: testTenantId(10) });
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          tenantEditable: [{ kind: "mail", slug: OPEN_SLUG, access: { roles: ["Editor"] } }],
        }),
      ],
    });
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    for (const slug of [OPEN_SLUG, CLOSED_SLUG]) {
      await stack.http.writeOk(
        TemplateResolverHandlers.upsertSystem,
        mailPayload(slug, { status: "active" }),
        systemAdmin,
      );
    }
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("the overview lists an opted-in role exactly the released template and refuses a TenantAdmin", async () => {
    const overview = await stack.http.queryOk<{ rows: readonly { slug: string }[] }>(
      TemplateResolverQueries.overview,
      {},
      editor,
    );
    expect(overview.rows.map((row) => row.slug)).toEqual([OPEN_SLUG]);

    const denied = await stack.http.queryErr(TemplateResolverQueries.overview, {}, tenantAdmin);
    expect(denied.httpStatus).toBe(403);
  });

  test("send-test-status answers an opted-in role and refuses a TenantAdmin", async () => {
    const status = await stack.http.queryOk(TemplateResolverQueries.sendTestStatus, {}, editor);
    expect(status).toEqual({ canSend: false, reason: "no_channel" });

    const denied = await stack.http.queryErr(
      TemplateResolverQueries.sendTestStatus,
      {},
      tenantAdmin,
    );
    expect(denied.httpStatus).toBe(403);
  });
});

describe("template edit policy :: mount validation", () => {
  const access = { roles: ["TenantAdmin"] };

  test("an empty slug throws", () => {
    expect(() =>
      createTemplateResolverFeature({ tenantEditable: [{ kind: "mail", slug: " ", access }] }),
    ).toThrow("empty slug");
  });

  test("an access rule without roles throws", () => {
    expect(() =>
      createTemplateResolverFeature({
        tenantEditable: [{ kind: "mail", slug: OPEN_SLUG, access: { roles: [] } }],
      }),
    ).toThrow("no roles");
  });

  test("the same kind and slug twice throws", () => {
    expect(() =>
      createTemplateResolverFeature({
        tenantEditable: [
          { kind: "mail", slug: OPEN_SLUG, access },
          { kind: "mail", slug: OPEN_SLUG, access },
        ],
      }),
    ).toThrow("twice");
  });
});
