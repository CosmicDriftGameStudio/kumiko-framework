// End to end through the real delivery jobs: a stored mail template with an inline logo
// (linked resource, system link or branding logo) plus a file attachment given at notify time.
// Uploads go through the real multipart POST /api/files, mails are sent by the real job runner
// into the in-memory transport, and the payload handed to delivery.send is inspected for bytes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  BRANDING_QN,
  createManagedPagesFeature,
  pageEntity,
} from "@cosmicdrift/kumiko-bundled-features/managed-pages";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import {
  createTemplateResolverFeature,
  SYSTEM_TENANT_ID,
  TemplateResolverHandlers,
  TemplateResolverQueries,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { seedNotificationTemplates } from "@cosmicdrift/kumiko-bundled-features/template-resolver/seeding";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineFeature,
  defineWriteHandler,
  QnTypes,
  qn,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-framework/testing";
import * as z from "zod";
import { createRendererMailHtmlFeature } from "../feature";

const FEATURE = "invoice-mail";
const INVOICE = qn(FEATURE, QnTypes.notify, "invoice");
const INHERIT = qn(FEATURE, QnTypes.notify, "inherit");
const IMMEDIATE = qn(FEATURE, QnTypes.notify, "immediate");
const BRANDED = qn(FEATURE, QnTypes.notify, "branded");
const PLAIN = qn(FEATURE, QnTypes.notify, "plain");
const SEND = qn(FEATURE, QnTypes.write, "send");

const LOGO_BODY = '<p>Your invoice</p><p><img data-resource="logo" alt="Logo"></p>';
// 1x1 PNG
const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4 invoice");

function mailNotification(subject: string) {
  return {
    variables: {},
    localizedTemplate: () => ({
      en: { body: LOGO_BODY, meta: { subject, category: "transactional" as const } },
    }),
  };
}

const invoiceFeature = defineFeature(FEATURE, (r) => {
  r.requires("delivery");
  r.notification("invoice", mailNotification("Invoice"));
  r.notification("inherit", mailNotification("Inherited"));
  r.notification("immediate", mailNotification("Immediate"));
  r.notification("branded", mailNotification("Branded"));
  r.notification("plain", {
    variables: {},
    localizedTemplate: () => ({
      en: { body: "<p>Plain</p>", meta: { subject: "Plain", category: "transactional" as const } },
    }),
  });
  r.writeHandler(
    defineWriteHandler({
      name: "send",
      schema: z.object({
        type: z.string(),
        fileRefId: z.string().optional(),
        immediate: z.boolean().optional(),
      }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        if (!ctx.notify) throw new Error("notify is not wired");
        const { type, fileRefId, immediate } = event.payload;
        await ctx.notify(type, {
          route: { email: "customer@example.com" },
          ...(immediate && { immediate }),
          data:
            fileRefId === undefined
              ? {}
              : { attachments: [{ kind: "file", fileRefId, fileName: "rechnung.pdf" }] },
        });
        return { isSuccess: true as const, data: {} };
      },
    }),
  );
});

const tenantAdmin = (id: number) =>
  createTestUser({ id, roles: ["TenantAdmin"], tenantId: testTenantId(id) });
const adminTenantA = tenantAdmin(31);
const adminTenantB = tenantAdmin(32);
const adminTenantC = tenantAdmin(33);
const adminTenantD = tenantAdmin(34);
const adminTenantE = tenantAdmin(35);
const adminTenantF = tenantAdmin(36);
const adminTenantG = tenantAdmin(37);

// Job failures only surface as a bare error code; the job's error log names the failing step.
const loggedErrors: string[] = [];

const transport = createInMemoryTransport();
const provider = createInMemoryFileProvider();
let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createConfigFeature(),
      createTenantFeature(),
      createManagedPagesFeature({ resolveApexTenant: () => null }),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport,
        resolveEmail: async () => "unused@test.local",
      }),
      invoiceFeature,
    ],
    files: { storageProvider: provider },
    jobs: {
      consumerLane: "worker",
      runLogger: () => ({
        onJobFailed: (_jobName, _jobId, _error, logs) => {
          for (const entry of logs) if (entry.level === "error") loggedErrors.push(entry.message);
        },
      }),
    },
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity, "template-resource");
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  await seedNotificationTemplates(stack.db, stack.registry);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(() => {
  transport.sent.length = 0;
});

async function upload(
  as: typeof adminTenantA,
  bytes: Uint8Array,
  file: { name: string; type: string },
): Promise<string> {
  const token = await stack.jwt.sign(as);
  const fd = new FormData();
  fd.append("file", new File([Buffer.from(bytes)], file.name, { type: file.type }));
  const { body, contentType } = await buildMultipartBody(fd);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function uploadResource(
  as: typeof adminTenantA,
  link?: { templateId: string; tenantIdOverride?: string },
): Promise<string> {
  const sourceFileRefId = await upload(as, PNG_BYTES, { name: "logo.png", type: "image/png" });
  const result = await stack.http.writeOk<{ fileRefId: string }>(
    TemplateResolverHandlers.resourceUpload,
    { sourceFileRefId, ...(link && { ...link, key: "logo" }) },
    as,
  );
  return result.fileRefId;
}

async function storedBytes(fileRefId: string): Promise<Uint8Array> {
  const [row] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, {
    id: fileRefId,
  });
  if (row === undefined) throw new Error(`no file ref ${fileRefId}`);
  return provider.read(row.storageKey);
}

async function systemTemplateId(slug: string): Promise<string> {
  const rows = await stack.http.queryOk<readonly { id: string; slug: string }[]>(
    TemplateResolverQueries.list,
    { kind: "mail", locale: "en", includeSystem: true },
    TestUsers.systemAdmin,
  );
  const found = rows.find((row) => row.slug === slug);
  if (found === undefined) throw new Error(`no system template ${slug}`);
  return found.id;
}

async function publishTenantOverride(
  as: typeof adminTenantA,
  slug: string,
  options: { content?: string; layoutSlug?: string } = {},
): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    {
      slug,
      kind: "mail",
      locale: "en",
      content: options.content ?? LOGO_BODY,
      contentFormat: "html",
      meta: {
        subject: "Tenant subject",
        ...(options.layoutSlug !== undefined && { layoutSlug: options.layoutSlug }),
      },
      variableSchema: {},
    },
    as,
  );
  await stack.http.writeOk(TemplateResolverHandlers.publish, { id: created.id }, as);
  return created.id;
}

async function sendMail(
  as: typeof adminTenantA,
  type: string,
  fileRefId?: string,
  immediate?: boolean,
) {
  await stack.http.writeOk(
    SEND,
    { type, ...(fileRefId && { fileRefId }), ...(immediate && { immediate }) },
    as,
  );
  loggedErrors.length = 0;
  try {
    await stack.drainJobs();
  } catch (error) {
    throw new Error(`${String(error)} | logged: ${[...new Set(loggedErrors)].join(" | ")}`, {
      cause: error,
    });
  }
  const mail = transport.sent.at(-1);
  if (mail === undefined) throw new Error("no mail was sent");
  return mail;
}

// The send job payload carries refs only: its attachment schema is strict, so a
// ref with bytes would fail delivery.send and no mail would reach the transport.

describe("mail attachments: inline logo and file attachment", () => {
  test("a tenant template's own logo and a notify-time file arrive as two attachments", async () => {
    const templateId = await publishTenantOverride(adminTenantA, INVOICE);
    const logoFileRefId = await uploadResource(adminTenantA, { templateId });
    const pdfFileRefId = await upload(adminTenantA, PDF_BYTES, {
      name: "scan.pdf",
      type: "application/pdf",
    });

    const mail = await sendMail(adminTenantA, INVOICE, pdfFileRefId);

    expect(mail.html).toContain('src="cid:logo"');
    expect(mail.attachments).toHaveLength(2);
    const inline = mail.attachments?.find((a) => a.kind === "inline");
    const file = mail.attachments?.find((a) => a.kind === "file");
    expect(inline).toMatchObject({ kind: "inline", cid: "logo", contentType: "image/png" });
    expect(Buffer.from(inline?.content ?? [])).toEqual(
      Buffer.from(await storedBytes(logoFileRefId)),
    );
    expect(file).toMatchObject({ kind: "file", fileName: "rechnung.pdf" });
    expect(Buffer.from(file?.content ?? [])).toEqual(Buffer.from(PDF_BYTES));
  });

  test("without an own link the tenant's branding logo is used for cid logo", async () => {
    const brandingFileRefId = await uploadResource(adminTenantB);
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.logoFile, value: brandingFileRefId },
      adminTenantB,
    );

    const mail = await sendMail(adminTenantB, BRANDED);

    expect(mail.html).toContain('src="cid:logo"');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0]).toMatchObject({ kind: "inline", cid: "logo" });
    expect(Buffer.from(mail.attachments?.[0]?.content ?? [])).toEqual(
      Buffer.from(await storedBytes(brandingFileRefId)),
    );
  });

  test("a tenant override inherits the image of the system template", async () => {
    const systemId = await systemTemplateId(INHERIT);
    const systemLogoFileRefId = await uploadResource(TestUsers.systemAdmin, {
      templateId: systemId,
      tenantIdOverride: SYSTEM_TENANT_ID,
    });
    await publishTenantOverride(adminTenantC, INHERIT);

    const mail = await sendMail(adminTenantC, INHERIT);

    expect(mail.html).toContain('src="cid:logo"');
    expect(mail.attachments).toHaveLength(1);
    expect(Buffer.from(mail.attachments?.[0]?.content ?? [])).toEqual(
      Buffer.from(await storedBytes(systemLogoFileRefId)),
    );
  });

  test("an immediate notify (no job runner involved) reads the attachments too", async () => {
    const templateId = await publishTenantOverride(adminTenantD, IMMEDIATE);
    const logoFileRefId = await uploadResource(adminTenantD, { templateId });

    const mail = await sendMail(adminTenantD, IMMEDIATE, undefined, true);

    expect(mail.html).toContain('src="cid:logo"');
    expect(mail.attachments).toHaveLength(1);
    expect(Buffer.from(mail.attachments?.[0]?.content ?? [])).toEqual(
      Buffer.from(await storedBytes(logoFileRefId)),
    );
  });

  test("a branding logo token pointing at another tenant's file is dropped", async () => {
    const foreignFileRefId = await uploadResource(adminTenantF);
    await stack.http.writeOk(
      "config:write:set",
      { key: BRANDING_QN.logoFile, value: foreignFileRefId },
      adminTenantE,
    );

    const mail = await sendMail(adminTenantE, BRANDED);

    expect(mail.html).not.toContain("cid:logo");
    expect(mail.attachments ?? []).toHaveLength(0);
  });

  test("an image in the data-header of a tenant layout is sent as an inline attachment", async () => {
    const layout = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: "letterhead",
        kind: "mail-layout",
        locale: "en",
        content:
          '<div data-header><img data-resource="logo" alt="Logo"></div><div data-content></div><div data-footer></div>',
        contentFormat: "html",
        meta: {},
        variableSchema: {},
      },
      adminTenantG,
    );
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id: layout.id }, adminTenantG);
    const logoFileRefId = await uploadResource(adminTenantG, { templateId: layout.id });
    await publishTenantOverride(adminTenantG, PLAIN, {
      content: "<p>Plain</p>",
      layoutSlug: "letterhead",
    });

    const mail = await sendMail(adminTenantG, PLAIN);

    expect(mail.html).toContain('src="cid:logo"');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments?.[0]).toMatchObject({ kind: "inline", cid: "logo" });
    expect(Buffer.from(mail.attachments?.[0]?.content ?? [])).toEqual(
      Buffer.from(await storedBytes(logoFileRefId)),
    );
  });

  // Stays last: its deliberately failing send job is retried with a backoff that can outlive the drain.
  test("a file attachment of another tenant is not sent", async () => {
    const foreignPdf = await upload(adminTenantF, PDF_BYTES, {
      name: "foreign.pdf",
      type: "application/pdf",
    });
    await publishTenantOverride(adminTenantE, INVOICE);

    await stack.http.writeOk(SEND, { type: INVOICE, fileRefId: foreignPdf }, adminTenantE);
    // failAttempt rethrows only the code; the "not found" detail goes to the log.
    await expect(stack.drainJobs()).rejects.toThrow(/send_failed/);

    expect(transport.sent).toHaveLength(0);
  });
});
