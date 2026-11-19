// Drafts go through the real HTTP pipeline, resolver and print client; only the print service
// is a local HTTP stub that returns fixed PDF bytes and records the HTML it was asked to print.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  buildEntityTable,
  createEventStoreExecutor,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
} from "@cosmicdrift/kumiko-framework/files";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthFoundationFeature } from "../../auth-foundation/index.ts";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import {
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/index.ts";
import { renderedPdfEntity } from "../../renderer-puppeteer-client/entity.ts";
import { createRendererPuppeteerClientFeature } from "../../renderer-puppeteer-client/feature.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import {
  createTemplateResolverFeature,
  TemplateResolverHandlers,
} from "../../template-resolver/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../../user-data-rights/feature.ts";
import { ungatedDocumentDraftExecutor } from "../entity.ts";
import { createDocumentDraftFeature } from "../feature.ts";
import { forgetDocumentDraftsOfSubject } from "../user-data.ts";
import { DocumentDraftHandlers, DocumentDraftQueries } from "../web/constants.ts";

const BASE = "lease-contract";
const OWN_VARIANT = `${BASE}:commercial`;
const FOREIGN_VARIANT = "other-contract:short";
const SUBJECT_TYPE = "lease";
let SUBJECT: string;
let FORGET_SUBJECT: string;
let KEEP_SUBJECT: string;
let DISCARD_SUBJECT: string;
let TRAIL_SUBJECT: string;
const CLAUSE = "Haustiere sind erlaubt.";
const STUB_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<< /Type /Pages /Kids [] /Count 1 >>endobj\n%%EOF",
);
const SERVICE_TOKEN = "document-draft-test-service-token";
const ENV_KEYS = ["PUPPETEER_SERVICE_URL", "PUPPETEER_AUTH_TOKEN"] as const;
const savedEnv = new Map<string, string | undefined>();
const SECRET_TENANT_NAME = "Geheim Mieterin";
const REPEAT_BASE = "repeat-contract";
const REPEAT_BODY =
  '<p>Staffel</p><table><tbody><tr data-if="rentSteps" data-repeat-header=""><th><p>Ab</p></th></tr><tr data-each="rentSteps"><td><p><span data-variable="from"></span></p></td></tr></tbody></table>';

const TENANT = testTenantId(9801);
const admin = createTestUser({ id: 9801, roles: ["TenantAdmin"], tenantId: TENANT });
const allowedMember = createTestUser({
  id: 9802,
  roles: ["TenantMember"],
  tenantId: TENANT,
  claims: { team: "team-a" },
});
const blockedMember = createTestUser({
  id: 9803,
  roles: ["TenantMember"],
  tenantId: TENANT,
  claims: { team: "team-b" },
});
const foreignAdmin = createTestUser({
  id: 9804,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(9804),
});

const leaseEntity = createEntity({
  name: SUBJECT_TYPE,
  table: "document_draft_test_leases",
  fields: {
    teamId: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "technical_reference",
    }),
  },
  access: {
    read: {
      TenantAdmin: "all",
      TenantMember: {
        kind: "where",
        where: (user, ctx) => ({
          sqlText: `${ctx.tableName}.team_id = $${ctx.paramStart}`,
          params: [user.claims?.["team"] ?? null],
        }),
      },
    },
  } satisfies NonNullable<EntityDefinition["access"]>,
});

const leaseHostFeature = defineFeature("document-draft-test-lease-host", (r) => {
  r.entity(leaseEntity);
});

const leaseExecutor = createEventStoreExecutor(buildEntityTable(leaseEntity), leaseEntity, {
  entityName: SUBJECT_TYPE,
});

async function seedLease(teamId: string): Promise<string> {
  const created = await leaseExecutor.create(
    { teamId },
    admin,
    createTenantDb({
      db: stack.db,
      tenantId: TENANT,
      mode: "system",
      reason: "test seeds the subject row",
    }),
  );
  if (!created.isSuccess) throw new Error(`lease create failed: ${created.error.message}`);
  return String(created.data.id);
}

const provider = createInMemoryFileProvider();
const printedHtml: string[] = [];
const stubService = Bun.serve({
  port: 0,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (
      pathname !== "/render" ||
      request.headers.get("Authorization") !== `Bearer ${SERVICE_TOKEN}`
    ) {
      return new Response("unauthorized", { status: 401 });
    }
    const body: { html: string } = await request.json();
    printedHtml.push(body.html);
    return new Response(STUB_PDF, { headers: { "Content-Type": "application/pdf" } });
  },
});
const STUB_URL = `http://127.0.0.1:${stubService.port}`;
let stack: TestStack;

const documentPayload = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  kind: "document-pdf" as const,
  locale: "de",
  content:
    '<p>Mietvertrag fuer <span data-variable="partyName"></span></p><p>Zweiter Absatz</p><p>Dritter Absatz</p>',
  contentFormat: "html" as const,
  variableSchema: { partyName: { type: "text" } },
  linkedResources: {},
  ...extra,
});

type Created = { id: string; version: number };
type Blocks = {
  id: string;
  version: number;
  status: string;
  revision: number;
  templateVersion: number;
  templateTitle: string | null;
  body: string;
  templateBody: string;
  blocks: { id: string; text?: string }[];
  deviations: { change: string }[];
  subjectScreen: string | null;
  variableSchema: Record<string, unknown>;
  variables: Record<string, unknown>;
  fileRefId: string | null;
};

const create = (extra: Record<string, unknown> = {}, user = admin) =>
  stack.http.writeOk<Created>(
    DocumentDraftHandlers.create,
    {
      subjectType: SUBJECT_TYPE,
      subjectId: SUBJECT,
      templateSlug: BASE,
      variables: { partyName: SECRET_TENANT_NAME },
      ...extra,
    },
    user,
  );

const blocksOf = (id: string, user = admin) =>
  stack.http.queryOk<Blocks>(DocumentDraftQueries.blocks, { id }, user);

const insertClause = (after: string | null = "b0") => ({
  op: "insertBlock" as const,
  after,
  block: { type: "paragraph" as const, text: CLAUSE },
});

beforeAll(async () => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createUserDataRightsFeature(),
      createFilesFeature(),
      leaseHostFeature,
      createConfigFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({
        tenantEditable: [
          { kind: "document-pdf", slug: BASE, access: { roles: ["TenantAdmin"] }, variants: true },
        ],
      }),
      createRendererFoundationFeature(),
      createRendererPuppeteerClientFeature(),
      createDocumentDraftFeature({
        subjectTypes: [SUBJECT_TYPE],
        subjectScreens: { [SUBJECT_TYPE]: "lease-detail" },
      }),
    ],
    files: { storageProvider: provider },
    extraContext: (deps) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
    }),
  });

  await unsafeCreateEntityTable(stack.db, renderedPdfEntity, "rendered-pdf");

  SUBJECT = await seedLease("team-a");
  FORGET_SUBJECT = await seedLease("team-a");
  KEEP_SUBJECT = await seedLease("team-a");
  DISCARD_SUBJECT = await seedLease("team-a");
  TRAIL_SUBJECT = await seedLease("team-a");

  const system = (payload: Record<string, unknown>) =>
    stack.http.writeOk(TemplateResolverHandlers.upsertSystem, payload, TestUsers.systemAdmin);
  await system(documentPayload(BASE));
  await system(
    documentPayload(REPEAT_BASE, {
      content: REPEAT_BODY,
      variableSchema: {
        rentSteps: { type: "list", item: { from: { type: "text" } } },
      },
    }),
  );
  await system(documentPayload(FOREIGN_VARIANT, { meta: { variantOf: "other-contract" } }));
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertTenant,
    documentPayload(OWN_VARIANT, {
      content: "<p>Gewerbemietvertrag</p>",
      meta: { variantOf: BASE },
      status: "active",
    }),
    admin,
  );
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
  await stubService.stop(true);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv.get(key);
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

beforeEach(() => {
  printedHtml.length = 0;
  provider.clear();
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env["PUPPETEER_SERVICE_URL"] = STUB_URL;
  process.env["PUPPETEER_AUTH_TOKEN"] = SERVICE_TOKEN;
});

describe("create", () => {
  test("freezes the template text, leaves the template unchanged and takes a variant", async () => {
    const templateVersion = async () =>
      (
        await stack.http.queryOk<{ base: { version: number } }>(
          "template-resolver:query:document-blocks",
          { slug: BASE, kind: "document-pdf", locale: "de" },
          TestUsers.systemAdmin,
        )
      ).base.version;
    const before = await templateVersion();

    const created = await create();
    const draft = await blocksOf(created.id);
    expect(draft.status).toBe("open");
    expect(draft.subjectScreen).toBe("lease-detail");
    expect(draft.variables).toEqual({ partyName: SECRET_TENANT_NAME });
    expect(Object.keys(draft.variableSchema)).toContain("partyName");
    expect(draft.body).toContain('data-variable="partyName"');
    expect(draft.templateBody).toBe(draft.body);
    expect(draft.deviations.every((block) => block.change === "same")).toBe(true);
    expect(draft.version).toBe(created.version);
    expect(await templateVersion()).toBe(before);

    const variantDraft = await create({ variant: OWN_VARIANT });
    expect((await blocksOf(variantDraft.id)).body).toContain("Gewerbemietvertrag");
  });

  test("stores the title of the template row the draft is created from, null when it has none", async () => {
    expect((await blocksOf((await create()).id)).templateTitle).toBeNull();

    const titled = await stack.http.writeOk<{ slug: string }>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: BASE, name: "furnished", title: "Moebliert", locale: "de" },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: titled.slug, kind: "document-pdf", locale: "de" }] },
      admin,
    );
    const variantDraft = await create({ variant: titled.slug });
    expect((await blocksOf(variantDraft.id)).templateTitle).toBe("Moebliert");
  });

  test("a variant of another base and an unknown template fail with 422 reasons, an unknown subjectType with 400", async () => {
    for (const [extra, reason] of [
      [{ variant: FOREIGN_VARIANT }, "template_variant_unknown"],
      [{ variant: `${BASE}:missing` }, "template_variant_unknown"],
      [{ templateSlug: "no-such-template" }, "template_not_found"],
    ] as const) {
      const error = await stack.http.writeErr(
        DocumentDraftHandlers.create,
        {
          subjectType: SUBJECT_TYPE,
          subjectId: SUBJECT,
          templateSlug: BASE,
          variables: {},
          ...extra,
        },
        admin,
      );
      expect({ status: error.httpStatus, details: error.details }).toEqual({
        status: 422,
        details: { reason },
      });
    }
    const unknownType = await stack.http.writeErr(
      DocumentDraftHandlers.create,
      { subjectType: "invoice", subjectId: SUBJECT, templateSlug: BASE, variables: {} },
      admin,
    );
    expect(unknownType.httpStatus).toBe(400);
  });
});

describe("patch", () => {
  test("insertBlock, replaceText and removeBlock change only this draft", async () => {
    const first = await create();
    const second = await create();

    const inserted = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.patch,
      { id: first.id, base: first.version, ops: [insertClause()] },
      admin,
    );
    const replaced = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.patch,
      {
        id: first.id,
        base: inserted.version,
        ops: [{ op: "replaceText", blockId: "b2", find: "Zweiter", replace: "Geaenderter" }],
      },
      admin,
    );
    await stack.http.writeOk(
      DocumentDraftHandlers.patch,
      { id: first.id, base: replaced.version, ops: [{ op: "removeBlock", blockId: "b3" }] },
      admin,
    );

    const edited = await blocksOf(first.id);
    expect(edited.body).toContain(CLAUSE);
    expect(edited.body).toContain("Geaenderter Absatz");
    expect(edited.body).not.toContain("Dritter Absatz");
    expect(edited.deviations.some((block) => block.change !== "same")).toBe(true);

    const untouched = await blocksOf(second.id);
    expect(untouched.body).toBe(untouched.templateBody);
  });

  test("a stale base fails with version_conflict", async () => {
    const created = await create();
    await stack.http.writeOk(
      DocumentDraftHandlers.patch,
      { id: created.id, base: created.version, ops: [insertClause()] },
      admin,
    );
    const error = await stack.http.writeErr(
      DocumentDraftHandlers.patch,
      { id: created.id, base: created.version, ops: [insertClause()] },
      admin,
    );
    expect(error.code).toBe("version_conflict");
  });

  test("setVariable, setMeta and setResource are refused as op_not_allowed", async () => {
    const created = await create();
    const error = await stack.http.writeErr(
      DocumentDraftHandlers.patch,
      {
        id: created.id,
        base: created.version,
        ops: [insertClause(), { op: "setMeta", meta: { title: "x" } }],
      },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    expect(JSON.stringify(error)).toContain("op_not_allowed");
    expect(JSON.stringify(error)).toContain("ops.1");
  });
});

describe("save", () => {
  test("stores the sanitized HTML and refuses disallowed HTML", async () => {
    const created = await create();
    const saved = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.save,
      { id: created.id, base: created.version, content: "<p>Neuer Text</p>" },
      admin,
    );
    expect((await blocksOf(created.id)).body).toContain("Neuer Text");

    const error = await stack.http.writeErr(
      DocumentDraftHandlers.save,
      { id: created.id, base: saved.version, content: "<script>alert(1)</script><p>x</p>" },
      admin,
    );
    expect(error.httpStatus).toBe(400);
    expect((await blocksOf(created.id)).body).not.toContain("script");
  });
});

describe("repeat table template", () => {
  test("keeps data-each and data-repeat-header, an unchanged save shows no deviation and finalize prints the repeated rows", async () => {
    const created = await create({
      templateSlug: REPEAT_BASE,
      variables: { rentSteps: [{ from: "ab 2027" }, { from: "ab 2028" }] },
    });
    const fresh = await blocksOf(created.id);
    expect(fresh.body).toBe(fresh.templateBody);
    expect(fresh.body).toContain('data-each="rentSteps"');
    expect(fresh.body).toContain('data-repeat-header=""');
    expect(fresh.deviations.filter((d) => d.change !== "same")).toEqual([]);

    const saved = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.save,
      { id: created.id, base: created.version, content: fresh.body },
      admin,
    );
    const afterSave = await blocksOf(created.id);
    expect(afterSave.body).toBe(fresh.templateBody);
    expect(afterSave.deviations.filter((d) => d.change !== "same")).toEqual([]);

    await stack.http.writeOk(
      DocumentDraftHandlers.finalize,
      { id: created.id, base: saved.version },
      admin,
    );
    expect(printedHtml).toHaveLength(1);
    expect(printedHtml[0]).toContain("Staffel");
    expect(printedHtml[0]).toContain("ab 2027");
    expect(printedHtml[0]).toContain("ab 2028");
  });
});

describe("finalize and revise", () => {
  test("finalize prints the edited body with the variables, stores the file and closes the draft; revise reopens", async () => {
    const created = await create();
    const patched = await stack.http.writeOk<{ version: number }>(
      DocumentDraftHandlers.patch,
      { id: created.id, base: created.version, ops: [insertClause()] },
      admin,
    );

    const finalized = await stack.http.writeOk<{
      fileRefId: string;
      fileName: string;
      revision: number;
    }>(DocumentDraftHandlers.finalize, { id: created.id, base: patched.version }, admin);
    expect(finalized.revision).toBe(1);
    expect(printedHtml).toHaveLength(1);
    expect(printedHtml[0]).toContain(SECRET_TENANT_NAME);
    expect(printedHtml[0]).toContain(CLAUSE);

    const closed = await blocksOf(created.id);
    expect(closed.status).toBe("finalized");
    expect(closed.fileRefId).toBe(finalized.fileRefId);

    const notOpen = await stack.http.writeErr(
      DocumentDraftHandlers.patch,
      { id: created.id, base: closed.version, ops: [insertClause()] },
      admin,
    );
    expect(notOpen.details).toEqual({ reason: "document_draft_not_open" });

    const revised = await stack.http.writeOk<{ revision: number }>(
      DocumentDraftHandlers.revise,
      { id: created.id, base: closed.version },
      admin,
    );
    expect(revised.revision).toBe(2);
    const reopened = await blocksOf(created.id);
    expect(reopened.status).toBe("open");
    expect(reopened.revision).toBe(2);
    expect(reopened.fileRefId).toBeNull();
  });

  test("discard hides the draft from by-subject", async () => {
    const created = await create({ subjectId: DISCARD_SUBJECT });
    const listed = () =>
      stack.http.queryOk<{ id: string }[]>(
        DocumentDraftQueries.bySubject,
        { subjectType: SUBJECT_TYPE, subjectId: DISCARD_SUBJECT },
        admin,
      );
    expect((await listed()).map((row) => row.id)).toEqual([created.id]);
    await stack.http.writeOk(
      DocumentDraftHandlers.discard,
      { id: created.id, base: created.version },
      admin,
    );
    expect(await listed()).toEqual([]);
  });
});

describe("event trail and erasure", () => {
  test("each patch is an event with the user and the ops, not readable in the event store", async () => {
    const created = await create({ subjectId: TRAIL_SUBJECT });
    await stack.http.writeOk(
      DocumentDraftHandlers.patch,
      { id: created.id, base: created.version, ops: [insertClause()] },
      admin,
    );

    const rows: readonly Record<string, unknown>[] = await selectMany(stack.db, eventsTable, {
      aggregateId: created.id,
    });
    const events = [...rows].sort((a, b) => Number(a["version"]) - Number(b["version"]));
    expect(events).toHaveLength(2);
    const patchEvent = events[1];
    expect(String(patchEvent?.["createdBy"])).toBe(admin.id);
    const stored = JSON.stringify(events.map((event) => event["payload"]));
    expect(stored).toContain("kumiko-pii:");
    expect(stored).not.toContain(CLAUSE);
    expect(stored).not.toContain(SECRET_TENANT_NAME);

    const draft = await blocksOf(created.id);
    expect(draft.body).toContain(CLAUSE);
  });

  test("forgetDocumentDraftsOfSubject makes the body unreadable and leaves other subjects alone", async () => {
    const erased = await create({ subjectId: FORGET_SUBJECT });
    const kept = await create({ subjectId: KEEP_SUBJECT });
    await stack.http.writeOk(
      DocumentDraftHandlers.patch,
      { id: erased.id, base: erased.version, ops: [insertClause()] },
      admin,
    );

    const db = createTenantDb({
      db: stack.db,
      tenantId: TENANT,
      mode: "system",
      reason: "test reads the draft row after the subject was erased",
    });
    const result = await forgetDocumentDraftsOfSubject(
      { db, user: admin },
      { subjectType: SUBJECT_TYPE, subjectId: FORGET_SUBJECT },
    );
    expect(result).toEqual({ erased: 1 });

    const gone = await ungatedDocumentDraftExecutor.detail({ id: erased.id }, admin, db);
    expect(gone).toBeNull();
    expect(JSON.stringify(gone)).not.toContain(CLAUSE);
    expect(JSON.stringify(gone)).not.toContain(SECRET_TENANT_NAME);
    expect((await blocksOf(kept.id)).body).toContain("Mietvertrag");
  });
});

describe("access", () => {
  test("a draft of another tenant answers not found on every handler and query", async () => {
    const created = await create();
    for (const [type, payload] of [
      [
        DocumentDraftHandlers.patch,
        { id: created.id, base: created.version, ops: [insertClause()] },
      ],
      [DocumentDraftHandlers.save, { id: created.id, base: created.version, content: "<p>x</p>" }],
      [DocumentDraftHandlers.finalize, { id: created.id, base: created.version }],
      [DocumentDraftHandlers.discard, { id: created.id, base: created.version }],
    ] as const) {
      expect((await stack.http.writeErr(type, payload, foreignAdmin)).httpStatus).toBe(404);
    }
    expect(
      (await stack.http.queryErr(DocumentDraftQueries.blocks, { id: created.id }, foreignAdmin))
        .httpStatus,
    ).toBe(404);
    expect(printedHtml).toEqual([]);
  });

  test("a subject the user cannot read answers not found, one they can read lets them through", async () => {
    const created = await create();
    for (const [type, payload] of [
      [
        DocumentDraftHandlers.create,
        { subjectType: SUBJECT_TYPE, subjectId: SUBJECT, templateSlug: BASE, variables: {} },
      ],
      [
        DocumentDraftHandlers.patch,
        { id: created.id, base: created.version, ops: [insertClause()] },
      ],
      [DocumentDraftHandlers.finalize, { id: created.id, base: created.version }],
    ] as const) {
      expect((await stack.http.writeErr(type, payload, blockedMember)).httpStatus).toBe(404);
    }
    expect(
      (await stack.http.queryErr(DocumentDraftQueries.blocks, { id: created.id }, blockedMember))
        .httpStatus,
    ).toBe(404);
    expect(
      (
        await stack.http.queryErr(
          DocumentDraftQueries.bySubject,
          { subjectType: SUBJECT_TYPE, subjectId: SUBJECT },
          blockedMember,
        )
      ).httpStatus,
    ).toBe(404);
    expect(printedHtml).toEqual([]);

    // Neither a wrong base nor a finalized draft may tell a blocked user anything but NotFound.
    const wrongBase = { id: created.id, base: Number(created.version) + 99 };
    expect(
      (await stack.http.writeErr(DocumentDraftHandlers.finalize, wrongBase, blockedMember))
        .httpStatus,
    ).toBe(404);
    await stack.http.writeOk(
      DocumentDraftHandlers.finalize,
      { id: created.id, base: created.version },
      allowedMember,
    );
    const printsBefore = printedHtml.length;
    expect(
      (
        await stack.http.writeErr(
          DocumentDraftHandlers.finalize,
          { id: created.id, base: created.version },
          blockedMember,
        )
      ).httpStatus,
    ).toBe(404);
    expect(printedHtml).toHaveLength(printsBefore);

    const own = await create({}, allowedMember);
    expect((await blocksOf(own.id, allowedMember)).id).toBe(own.id);
    expect((await blocksOf(own.id, admin)).id).toBe(own.id);
  });
});
