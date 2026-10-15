// Unit tests for mailHtmlRender. They cover the pipeline steps one by one:
// Handlebars content, Markdown conversion, layout wrapping, MJML compile,
// html-to-text. ctx is stubbed — we do NOT test the template-resolver
// path here (integration tests with a real DB do that).

import { describe, expect, test } from "bun:test";
import type {
  RendererContext,
  RenderRequest,
} from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { RendererError } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { mailHtmlRender } from "../render";

// Stub ctx — the plugin uses db via createTemplateResolverApi(ctx.db).
// The TenantDb delegate stub returns `[]` for every lookup, so
// resolveTemplate finds no layout and throws TemplateNotFoundError —
// exactly the case where render.ts falls back to DEFAULT_MAIL_LAYOUT_MJML.
// That means tests run purely on the in-code constant.
//
// Important: a generic Error here would NOT be swallowed anymore (render.ts
// narrows to TemplateNotFoundError since the error-swallow fix) — the stub
// must mimic the real "no template" path, not an arbitrary DB error.
// @cast-boundary db-stub — TenantDb-Delegate-Shape, nur selectMany aktiv.
const stubDb = {
  raw: { unsafe: () => Promise.reject(new Error("STUB: raw.unsafe unused")) },
  tenantId: "11111111-1111-4111-8111-111111111111",
  selectMany: async () => [],
  fetchOne: async () => undefined,
  insertOne: async () => undefined,
  updateMany: async () => [],
  deleteMany: async () => undefined,
} as unknown as RendererContext["db"];

const STUB_CTX: RendererContext = {
  db: stubDb,
  registry: null as never,
  tenantId: "11111111-1111-4111-8111-111111111111" as TenantId,
};

function makeReq(
  payload: Partial<RenderRequest["payload"] & { contentFormat?: "markdown" }>,
): RenderRequest {
  return {
    kind: "mail-html",
    payload: {
      content: payload.content ?? "",
      contentFormat: payload.contentFormat ?? "markdown",
      variables: payload.variables ?? {},
      locale: payload.locale,
    },
  };
}

// ctx whose template-resolver returns an ACTIVE layout with the given content,
// instead of falling back to the (valid) DEFAULT_MAIL_LAYOUT_MJML. Stub-db is
// shaped as a TenantDb-Delegate (raw.unsafe + selectMany + … + tenantId, see
// tenantDbDelegate); only selectMany is hit on the resolve path.
function makeBrokenLayoutCtx(layoutContent: string): RendererContext {
  const layoutRow = {
    id: "tpl-broken",
    version: 1,
    tenantId: STUB_CTX.tenantId,
    slug: "mail-layout",
    kind: "mail-html",
    locale: "en",
    content: layoutContent,
    contentFormat: "mjml",
    scope: "system",
    status: "active",
    linkedResources: null,
  };
  // @cast-boundary db-stub — TenantDb-Delegate-Shape, nur selectMany aktiv.
  const db = {
    raw: { unsafe: () => Promise.reject(new Error("STUB: raw.unsafe unused")) },
    tenantId: STUB_CTX.tenantId,
    selectMany: async () => [layoutRow],
    fetchOne: async () => undefined,
    insertOne: async () => undefined,
    updateMany: async () => [],
    deleteMany: async () => undefined,
  } as unknown as RendererContext["db"];
  return { ...STUB_CTX, db };
}

describe("mailHtmlRender :: Pipeline", () => {
  test("Markdown-Content wird zu HTML konvertiert", async () => {
    const result = await mailHtmlRender(
      makeReq({ content: "# Headline\n\nParagraph", variables: { appName: "Acme" } }),
      STUB_CTX,
    );
    expect(result.kind).toBe("mail-html");
    if (result.kind !== "mail-html") return;
    expect(result.html).toContain("Headline");
    expect(result.html).toContain("Paragraph");
  });

  test("Raw-HTML im Tenant-Markdown wird escaped, javascript:-Links neutralisiert", async () => {
    const result = await mailHtmlRender(
      makeReq({
        content: "Hi\n\n<script>alert(1)</script>\n\n[click](javascript:alert(1))",
        variables: {},
      }),
      STUB_CTX,
    );
    expect(result.kind).toBe("mail-html");
    if (result.kind !== "mail-html") return;
    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).not.toContain("javascript:");
  });

  test("Handlebars-Vars in content werden VOR marked substituiert", async () => {
    const result = await mailHtmlRender(
      makeReq({
        content: "Hallo {{name}}, deine ID ist {{id}}.",
        variables: { name: "Anna", id: "42", appName: "Acme" },
      }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    expect(result.html).toContain("Hallo Anna");
    expect(result.html).toContain("ID ist 42");
  });

  test("Layout-Vars (appName) werden nach Content substituiert", async () => {
    const result = await mailHtmlRender(
      makeReq({ content: "Body", variables: { appName: "MyCoolApp" } }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    // Default-Layout zeigt {{appName}} im Header
    expect(result.html).toContain("MyCoolApp");
  });

  test("Triple-stash {{{content}}} escaped HTML NICHT (Content-Slot)", async () => {
    const result = await mailHtmlRender(
      makeReq({
        content: "[Link](https://example.com)",
        variables: { appName: "Acme" },
      }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    // marked produces <a href="https://example.com">Link</a>, unescaped in the
    // slot — meaning the raw href ends up in the output.
    expect(result.html).toContain('href="https://example.com"');
    expect(result.html).toContain("Link</a>");
  });

  test("text/plain-Alternative ist gefüllt + URL-Erhalt", async () => {
    const result = await mailHtmlRender(
      makeReq({
        content: "Klick: [hier](https://example.com)",
        variables: { appName: "Acme" },
      }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    expect(result.text.length).toBeGreaterThan(0);
    // html-to-text with hideLinkHrefIfSameAsText: here text ≠ URL, so the URL is kept
    expect(result.text).toContain("https://example.com");
  });

  test("Optionale Variables — Plugin nimmt {} als Default", async () => {
    const result = await mailHtmlRender(makeReq({ content: "Static content, no vars" }), STUB_CTX);
    expect(result.kind).toBe("mail-html");
  });

  test("Empty content → RendererError invalid_payload", async () => {
    await expect(mailHtmlRender(makeReq({ content: "" }), STUB_CTX)).rejects.toThrow(RendererError);
  });

  test("Wrong kind → RendererError invalid_payload", async () => {
    const wrongReq = {
      kind: "notification" as const,
      payload: { content: "Body" },
    };
    await expect(mailHtmlRender(wrongReq, STUB_CTX)).rejects.toThrow(RendererError);
  });

  test("MJML-Output enthält table-Layout (Email-safe)", async () => {
    const result = await mailHtmlRender(
      makeReq({ content: "# Hi", variables: { appName: "Acme" } }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    // MJML always compiles to a <table> layout (for email-client compatibility)
    expect(result.html).toContain("<table");
  });

  test("RendererError code='invalid_payload' bei wrong kind", async () => {
    const wrongReq = {
      kind: "document-pdf" as const,
      payload: { content: "Body" },
    };
    const err = await mailHtmlRender(wrongReq, STUB_CTX).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RendererError);
    expect((err as RendererError).code).toBe("invalid_payload");
  });

  test("Broken content-Handlebars → code='invalid_payload' (Payload-Fehler)", async () => {
    const err = await mailHtmlRender(makeReq({ content: "{{#if cond}}no close" }), STUB_CTX).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RendererError);
    expect((err as RendererError).code).toBe("invalid_payload");
  });

  test("Broken layout-Handlebars (Step 4) → code='other', NICHT invalid_payload", async () => {
    const ctx = makeBrokenLayoutCtx("{{#if cond}}no close");
    const err = await mailHtmlRender(
      makeReq({ content: "Body", variables: { appName: "Acme" } }),
      ctx,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RendererError);
    expect((err as RendererError).code).toBe("other");
  });

  test("Invalid-MJML layout (Step 5) → code='other', NICHT invalid_payload", async () => {
    // Valid Handlebars, but an unknown MJML element → mjml2html reports an
    // error (validationLevel "soft"), step 5 throws. That is also a template
    // error, not a payload error.
    const ctx = makeBrokenLayoutCtx("<mjml><mj-body><mj-bogus>x</mj-bogus></mj-body></mjml>");
    const err = await mailHtmlRender(
      makeReq({ content: "Body", variables: { appName: "Acme" } }),
      ctx,
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RendererError);
    expect((err as RendererError).code).toBe("other");
  });

  test("Non-TemplateNotFound layout error → rethrow as code='other', NICHT silent DEFAULT-fallback", async () => {
    // A DB/connection error during layout lookup must NOT fall back to DEFAULT
    // — otherwise every mail renders without tenant branding and without an
    // alert on DB problems. Only TemplateNotFoundError is a legitimate
    // fallback trigger.
    const connErr = new Error("connection terminated unexpectedly");
    // @cast-boundary db-stub — TenantDb-Delegate-Shape, selectMany wirft.
    const db = {
      raw: { unsafe: () => Promise.reject(connErr) },
      tenantId: STUB_CTX.tenantId,
      selectMany: async () => {
        throw connErr;
      },
      fetchOne: async () => undefined,
      insertOne: async () => undefined,
      updateMany: async () => [],
      deleteMany: async () => undefined,
    } as unknown as RendererContext["db"];
    const err = await mailHtmlRender(makeReq({ content: "Body", variables: { appName: "Acme" } }), {
      ...STUB_CTX,
      db,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RendererError);
    if (!(err instanceof RendererError)) throw new Error("expected RendererError");
    expect(err.code).toBe("other");
  });

  test("Unsubscribe-URL conditional — wenn gesetzt, im Footer", async () => {
    const result = await mailHtmlRender(
      makeReq({
        content: "Body",
        variables: { appName: "Acme", unsubscribeUrl: "https://example.com/unsub" },
      }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    expect(result.html).toContain("https://example.com/unsub");
  });

  test("Unsubscribe-URL fehlt — kein Footer-Link", async () => {
    const result = await mailHtmlRender(
      makeReq({ content: "Body", variables: { appName: "Acme" } }),
      STUB_CTX,
    );
    if (result.kind !== "mail-html") throw new Error("wrong kind");
    expect(result.html).not.toContain("Unsubscribe");
  });
});
