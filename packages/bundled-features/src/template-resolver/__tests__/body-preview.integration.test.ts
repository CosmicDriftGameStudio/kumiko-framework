import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import { TemplateResolverQueries } from "../web/qualified-names.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const REJECTED_KEY = "templateResolver.errors.document.scriptElement";
const PREVIEW = TemplateResolverQueries.bodyPreview;

const adminA = createTestUser({ id: 30, roles: ["TenantAdmin"], tenantId: TENANT_A });
const memberA = createTestUser({ id: 31, roles: ["User"], tenantId: TENANT_A });

const editorA = createTestUser({ id: 32, roles: ["Editor"], tenantId: TENANT_A });

let stack: TestStack;
let stackWithEditors: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
  stackWithEditors = await setupTestStack({
    features: [
      createTemplateResolverFeature({
        tenantEditable: [{ kind: "mail", slug: "status-update", access: { roles: ["Editor"] } }],
      }),
    ],
  });
});

afterAll(async () => {
  await stack.cleanup();
  await stackWithEditors.cleanup();
});

describe("template-resolver :: body preview of an unsaved body", () => {
  test("a markdown draft renders to the html the public page would serve", async () => {
    const { html } = await stack.http.queryOk<{ html: string }>(
      PREVIEW,
      { body: "# About Acme\n\nWe build **calm** software.", bodyFormat: "markdown" },
      adminA,
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>calm</strong>");
  });

  test("a body without bodyFormat is markdown, like on save", async () => {
    const { html } = await stack.http.queryOk<{ html: string }>(
      PREVIEW,
      { body: "plain **markdown**" },
      adminA,
    );
    expect(html).toContain("<strong>markdown</strong>");
  });

  test("a document draft renders as sanitized html, not as escaped text", async () => {
    const { html } = await stack.http.queryOk<{ html: string }>(
      PREVIEW,
      {
        body: "<h2>What we stand for</h2><p>Hello <strong>document</strong></p>",
        bodyFormat: "document",
      },
      adminA,
    );
    expect(html).toContain("<strong>document</strong>");
    expect(html).not.toContain("&lt;strong&gt;");
  });

  test("an empty draft renders no visible content", async () => {
    const { html } = await stack.http.queryOk<{ html: string }>(
      PREVIEW,
      { body: null, bodyFormat: "document" },
      adminA,
    );
    expect(html.replace(/<[^>]*>/g, "")).toBe("");
  });

  test("a document draft the write rules reject answers with the field errors of a save", async () => {
    const error = await stack.http.queryErr(
      PREVIEW,
      { body: "<p>ok</p><script>alert(1)</script>", bodyFormat: "document" },
      adminA,
    );
    expectErrorIncludes(error, REJECTED_KEY);
    expectErrorIncludes(error, '"path":"body"');
  });

  test("a signed-in user without write access to pages is refused", async () => {
    const error = await stack.http.queryErr(
      PREVIEW,
      { body: "# Hi", bodyFormat: "markdown" },
      memberA,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("an anonymous visitor is refused", async () => {
    const response = await stack.app.request("http://a.example.com/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: PREVIEW, payload: { body: "# Hi" } }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  test("a role the app unlocked through tenantEditable may preview, one it did not may not", async () => {
    const { html } = await stackWithEditors.http.queryOk<{ html: string }>(
      PREVIEW,
      { body: "**ok**" },
      editorA,
    );
    expect(html).toContain("<strong>ok</strong>");
    expectErrorIncludes(
      await stackWithEditors.http.queryErr(PREVIEW, { body: "**no**" }, memberA),
      "access_denied",
    );
    expectErrorIncludes(
      await stack.http.queryErr(PREVIEW, { body: "**no**" }, editorA),
      "access_denied",
    );
  });
});
