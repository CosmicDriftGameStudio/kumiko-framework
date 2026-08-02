// Ownership is the second axis next to access: `access` decides WHO may reach
// a collection, `ownership` decides WHOSE rows they see once they are in.
//
// The four levels this pins, because each one has its own failure mode:
//   user    — two agents keep separate signatures under the same slug
//   tenant  — one curated set everyone in the tenant shares
//   system  — a SystemAdmin crossing tenants still writes their OWN entry
//   custom  — the app's role vocabulary gates both, independent of ownership
//
// The regression that motivates the user level: with one shared table and a
// nullable owner column, a signature would either collide on the unique index
// or silently be served to every agent.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createAnonymousUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature";
import { collectionHandlerName, collectionQueryName } from "../qualified-names";
import { templateResourceEntity } from "../table";
import {
  type UserContentEntryRow,
  userContentEntriesTable,
  userContentEntryEntity,
} from "../user-content-table";

let stack: TestStack;
let db: DbConnection;

// Same tenant, same role, different people — the pair the user level is about.
const agentA = createTestUser({ id: 11, roles: ["Agent"] });
const agentB = createTestUser({ id: 12, roles: ["Agent"] });
const tenantAdmin = createTestUser({ id: 13, roles: ["TenantAdmin"] });
const promptEngineer = createTestUser({ id: 14, roles: ["PromptEngineer"] });
const sysAdmin = createTestUser({ id: 15, roles: ["SystemAdmin", "Agent"] });
const otherTenantId = "00000000-0000-4000-8000-0000000000ff" as TenantId;
const foreignAgent = createTestUser({ id: 16, roles: ["Agent"], tenantId: otherTenantId });

const SIGNATURES_LIST = collectionQueryName("signatures", "list");
const SIGNATURES_ITEM = collectionQueryName("signatures", "item");
const SIGNATURES_SET = collectionHandlerName("signatures");
const SNIPPETS_LIST = collectionQueryName("reply-snippets", "list");
const SNIPPETS_SET = collectionHandlerName("reply-snippets");

const feature = createTemplateResolverFeature({
  collections: [
    {
      id: "signatures",
      kind: "mail-html",
      ownership: "user",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.signatures" },
    },
    {
      id: "reply-snippets",
      kind: "mail-html",
      access: { roles: ["Agent", "TenantAdmin"] },
      nav: { label: "mail:nav.snippets" },
    },
    {
      id: "ai-prompts",
      kind: "ai-prompt",
      ownership: "user",
      access: { roles: ["PromptEngineer"] },
      nav: { label: "mail:nav.prompts" },
    },
  ],
});

const signature = (title: string, content: string) => ({
  slug: "standard",
  locale: "de",
  title,
  content,
  contentFormat: "html" as const,
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await unsafeCreateEntityTable(db, userContentEntryEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("ownership 'user' :: every user keeps their own", () => {
  test("two agents hold the same slug side by side", async () => {
    const a = await stack.http.writeOk<{ isNew: boolean }>(
      SIGNATURES_SET,
      signature("Signatur A", "<p>Viele Grüße, A</p>"),
      agentA,
    );
    const b = await stack.http.writeOk<{ isNew: boolean }>(
      SIGNATURES_SET,
      signature("Signatur B", "<p>Beste Grüße, B</p>"),
      agentB,
    );

    // Both are creates, not an update of the other's row: the unique index is
    // (tenantId, ownerId, slug, kind, locale), so the second write does not
    // collide with the first.
    expect(a.isNew).toBe(true);
    expect(b.isNew).toBe(true);

    const rows = await selectMany<UserContentEntryRow>(db, userContentEntriesTable, {
      tenantId: agentA.tenantId,
      slug: "standard",
    });
    expect(rows.length).toBe(2);
    expect(new Set(rows.map((r) => r.ownerId))).toEqual(new Set([agentA.id, agentB.id]));
  });

  test("each agent lists only their own", async () => {
    const forA = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SIGNATURES_LIST,
      {},
      agentA,
    );
    const forB = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SIGNATURES_LIST,
      {},
      agentB,
    );
    expect(forA.blocks.map((b) => b.title)).toEqual(["Signatur A"]);
    expect(forB.blocks.map((b) => b.title)).toEqual(["Signatur B"]);
  });

  test("the item handler reads the caller's row, not the first match", async () => {
    const forA = await stack.http.queryOk<{ content: string }>(
      SIGNATURES_ITEM,
      { slug: "standard", locale: "de" },
      agentA,
    );
    const forB = await stack.http.queryOk<{ content: string }>(
      SIGNATURES_ITEM,
      { slug: "standard", locale: "de" },
      agentB,
    );
    expect(forA.content).toBe("<p>Viele Grüße, A</p>");
    expect(forB.content).toBe("<p>Beste Grüße, B</p>");
  });

  test("an update stays inside the caller's row", async () => {
    await stack.http.writeOk(SIGNATURES_SET, signature("Signatur A v2", "<p>MfG, A</p>"), agentA);

    const forB = await stack.http.queryOk<{ title: string; content: string }>(
      SIGNATURES_ITEM,
      { slug: "standard", locale: "de" },
      agentB,
    );
    expect(forB.title).toBe("Signatur B");
    expect(forB.content).toBe("<p>Beste Grüße, B</p>");
  });

  test("a user with no entry gets an empty list, not someone else's", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      SIGNATURES_LIST,
      {},
      tenantAdmin,
    );
    expect(result.blocks).toEqual([]);
  });

  test("and null from the item handler", async () => {
    const result = await stack.http.queryOk<unknown>(
      SIGNATURES_ITEM,
      { slug: "standard", locale: "de" },
      tenantAdmin,
    );
    expect(result).toBeNull();
  });
});

describe("ownership 'tenant' :: one set everyone shares", () => {
  test("what one agent writes, the other sees", async () => {
    await stack.http.writeOk(
      SNIPPETS_SET,
      {
        slug: "standard",
        locale: "de",
        title: "Team-Baustein",
        content: "<p>Wir melden uns.</p>",
        contentFormat: "html",
      },
      agentA,
    );

    const forB = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SNIPPETS_LIST,
      {},
      agentB,
    );
    expect(forB.blocks.map((b) => b.title)).toEqual(["Team-Baustein"]);
  });

  test("a second write to the same slug updates instead of creating", async () => {
    const result = await stack.http.writeOk<{ isNew: boolean }>(
      SNIPPETS_SET,
      {
        slug: "standard",
        locale: "de",
        title: "Team-Baustein v2",
        content: "<p>Wir melden uns zeitnah.</p>",
        contentFormat: "html",
      },
      agentB,
    );
    expect(result.isNew).toBe(false);
  });

  test("the two collections share a kind and stay separate stores", async () => {
    // Same kind (mail-html), same slug, same tenant — one is per-user, one is
    // shared. A single table with a nullable owner column would have to make
    // these collide.
    const snippets = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SNIPPETS_LIST,
      {},
      agentA,
    );
    const signatures = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SIGNATURES_LIST,
      {},
      agentA,
    );
    expect(snippets.blocks.map((b) => b.title)).toEqual(["Team-Baustein v2"]);
    expect(signatures.blocks.map((b) => b.title)).toEqual(["Signatur A v2"]);
  });
});

describe("system level :: cross-tenant override", () => {
  test("a SystemAdmin writing into another tenant still writes their OWN entry", async () => {
    await stack.http.writeOk(
      SIGNATURES_SET,
      { ...signature("Sysadmin-Signatur", "<p>Admin</p>"), tenantIdOverride: otherTenantId },
      sysAdmin,
    );

    const rows = await selectMany<UserContentEntryRow>(db, userContentEntriesTable, {
      tenantId: otherTenantId,
      slug: "standard",
    });
    expect(rows.map((r) => r.ownerId)).toEqual([sysAdmin.id]);
  });

  test("the foreign tenant's own agent does not see it", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      SIGNATURES_LIST,
      {},
      foreignAgent,
    );
    expect(result.blocks).toEqual([]);
  });

  test("and the home tenant is untouched by the cross-tenant write", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      SIGNATURES_LIST,
      {},
      agentA,
    );
    expect(result.blocks.map((b) => b.title)).toEqual(["Signatur A v2"]);
  });

  test("a non-SystemAdmin may not override the tenant", async () => {
    const error = await stack.http.writeErr(
      SIGNATURES_SET,
      { ...signature("Fremd", "<p>x</p>"), tenantIdOverride: otherTenantId },
      agentA,
    );
    expect(error.code).toBe("access_denied");
  });
});

describe("custom roles :: access gates ownership, not the other way round", () => {
  test("the declared role reaches its user-owned collection", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      collectionQueryName("ai-prompts", "list"),
      {},
      promptEngineer,
    );
    expect(result.blocks).toEqual([]);
  });

  test("an agent may not reach the prompt collection, user-owned or not", async () => {
    const error = await stack.http.queryErr(collectionQueryName("ai-prompts", "list"), {}, agentA);
    expect(error.code).toBe("access_denied");
  });

  test("the prompt role may not reach the signatures either", async () => {
    const error = await stack.http.queryErr(SIGNATURES_LIST, {}, promptEngineer);
    expect(error.code).toBe("access_denied");
  });

  test("anonymous reaches no user-owned collection", async () => {
    const anon = createAnonymousUser(agentA.tenantId);
    expect((await stack.http.queryErr(SIGNATURES_LIST, {}, anon)).code).toBe("access_denied");
  });
});

describe("GDPR :: the owner column is what makes erasure possible", () => {
  test("content is annotated userOwned against the ownerId column", () => {
    // The whole reason for a second table: `userOwned` is resolved per entity,
    // and resolveSubjectForField throws on an empty owner column — so a shared
    // table with nullable ownerId would break every tenant-wide write.
    const content = userContentEntryEntity.fields["content"];
    expect(content).toBeDefined();
    expect((content as { userOwned?: { ownerField: string } }).userOwned).toEqual({
      ownerField: "ownerId",
    });
  });

  test("the tenant-wide table keeps its business-data declaration", () => {
    const content = templateResourceEntity.fields["content"];
    expect((content as { allowPlaintext?: string }).allowPlaintext).toBe("is-business-data");
    expect((content as { userOwned?: unknown }).userOwned).toBeUndefined();
  });

  test("every user-owned row names its owner", async () => {
    const rows = await selectMany<UserContentEntryRow>(db, userContentEntriesTable, {});
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.ownerId).toBe("string");
      expect(row.ownerId.length).toBeGreaterThan(0);
    }
  });
});
