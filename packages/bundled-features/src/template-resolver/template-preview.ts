import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type {
  HandlerContext,
  SessionUser,
  TemplateListVariableDef,
  TemplateScalarVariableDef,
  TemplateVariables,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type KumikoError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from "@cosmicdrift/kumiko-framework/errors";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import { createI18n } from "@cosmicdrift/kumiko-framework/i18n";
import { escapeHtml } from "@cosmicdrift/kumiko-headless";
import { createEmailAttachmentReader, createTemplateMailRenderer } from "../delivery/index.js";
import { fileContextForTenant } from "../file-foundation/index.js";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  type MailAttachmentRef,
  RendererError,
  type RendererPlugin,
} from "../renderer-foundation/index.js";
import { createTemplateResolverApi, TemplateNotFoundError, type TemplateResource } from "./api.js";
import { collectDocumentResourceKeys } from "./compile-document-body.js";
import {
  DEFAULT_MAIL_LAYOUT_SLUG,
  DEFAULT_PDF_LAYOUT_SLUG,
  MAIL_PREVIEW_MAX_BYTES,
  SYSTEM_TENANT_ID,
  type TemplateScope,
} from "./constants.js";
import { parseStoredJson } from "./handlers/template-gates.js";
import { validateTemplateDraft } from "./handlers/validate.query.js";
import {
  type LayoutRegions,
  readLayoutRegions,
  sanitizeLayoutHtml,
  type TemplateWriteScope,
} from "./layout-regions.js";
import { type LinkedResourceEntry, parseLinkedResourceEntries } from "./linked-resources.js";
import { buildDisplayHtml } from "./preview-display-html.js";
import { TemplateResolverErrors } from "./qualified-names.js";
import { type TemplateResourceRow, templateResourcesTable } from "./table.js";
import {
  isMailTemplateMeta,
  type MailTemplateMeta,
  type PdfTemplateMeta,
  parseTemplateMeta,
  readPdfTemplateMeta,
} from "./template-meta.js";

const SAMPLE_LINK = "https://example.com";
const SAMPLE_DATE = "2026-01-15";
const SAMPLE_LIST_ROWS = 3;

// A variable label is an i18n key or plain text; an unknown key reads as itself.
type LabelText = (label: string) => string;

function sampleScalar(name: string, def: TemplateScalarVariableDef, labelText: LabelText): unknown {
  if (def.example !== undefined) return def.example;
  const label = def.label === undefined ? name : labelText(def.label);
  switch (def.type) {
    case "text":
      return `[${label}]`;
    case "richText":
      return `<p>[${escapeHtml(label)}]</p>`;
    case "link":
      return SAMPLE_LINK;
    case "money":
      return 0;
    case "date":
      return SAMPLE_DATE;
    case "percent":
      return 0;
  }
}

function sampleRow(
  item: TemplateListVariableDef["item"],
  labelText: LabelText,
  given: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(item)) row[name] = sampleScalar(name, def, labelText);
  return { ...row, ...given };
}

function sampleList(def: TemplateListVariableDef, labelText: LabelText): Record<string, unknown>[] {
  const rows = (def.example ?? [])
    .slice(0, SAMPLE_LIST_ROWS)
    .map((given) => sampleRow(def.item, labelText, given));
  while (rows.length < SAMPLE_LIST_ROWS) rows.push(sampleRow(def.item, labelText));
  return rows;
}

// Declared examples win; the fallbacks are deterministic so a preview never differs between calls.
export function sampleValuesFor(
  variables: TemplateVariables,
  labelText: LabelText = (label) => label,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(variables)) {
    values[name] =
      def.type === "list" ? sampleList(def, labelText) : sampleScalar(name, def, labelText);
  }
  return values;
}

function labelTextFor(ctx: HandlerContext, locale: string): LabelText {
  const i18n = createI18n(ctx.registry, { defaultLocale: "en" });
  return (label) => i18n.t(label, locale);
}

export type PreviewCheckCode =
  | "resources_resolved"
  | "text_present"
  | "size_under_cap"
  | "required_placeholders";

export type PreviewCheck = {
  readonly code: PreviewCheckCode;
  readonly ok: boolean;
  readonly i18nKey: string;
  readonly params?: Readonly<Record<string, unknown>>;
};

export type PreviewAttachment =
  | {
      readonly kind: "inline";
      readonly cid: string;
      readonly name: string;
      readonly sizeBytes: number;
    }
  | { readonly kind: "file"; readonly name: string; readonly sizeBytes: number }
  // Rendered when the mail is sent, so the preview knows the name but not the size.
  | {
      readonly kind: "rendered-pdf";
      readonly name: string;
      readonly templateSlug: string;
    };

export type PreviewLayout = {
  readonly slug: string;
  readonly scope: TemplateScope;
  readonly html: string;
  readonly regions: LayoutRegions;
};

export type TemplatePreviewInput = {
  readonly slug: string;
  readonly kind: "mail" | "document-pdf";
  readonly locale: string;
  readonly content?: string | undefined;
  readonly meta?: unknown;
  readonly variableSchema: Readonly<Record<string, unknown>>;
};

type ValidationResponse = Awaited<ReturnType<typeof validateTemplateDraft>>["response"];

export type TemplatePreview = {
  readonly kind: TemplatePreviewInput["kind"];
  readonly subject: string | null;
  readonly previewText: string | null;
  readonly html: string;
  /** Mail only: `html` with resolved inline images as data URIs, for showing in a browser. */
  readonly displayHtml?: string;
  readonly text: string | null;
  readonly attachments: readonly PreviewAttachment[];
  readonly layout: PreviewLayout | null;
  /** Mail only: which layout version the html was rendered through. */
  readonly mailLayout?: {
    readonly slug: string;
    readonly scope: TemplateScope;
    readonly version: number;
  } | null;
  readonly sampleValues: Readonly<Record<string, unknown>>;
  readonly checks: readonly PreviewCheck[];
  readonly validation: ValidationResponse;
};

export type TemplatePreviewOutcome =
  | {
      readonly ok: true;
      readonly preview: TemplatePreview;
      /** What the send path needs to attach; kept out of the response shown to the editor. */
      readonly mailAttachments: readonly MailAttachmentRef[];
      readonly sender: { readonly fromName?: string; readonly replyTo?: string };
    }
  | { readonly ok: false; readonly error: KumikoError };

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

const failed = (error: KumikoError): TemplatePreviewOutcome => ({ ok: false, error });

async function loadStoredDraft(
  ctx: HandlerContext,
  user: SessionUser,
  input: TemplatePreviewInput,
): Promise<TemplateResource | null> {
  try {
    return await createTemplateResolverApi(ctx.db).resolveTemplate({
      tenantId: user.tenantId,
      slug: input.slug,
      kind: input.kind,
      locale: input.locale,
    });
  } catch (e) {
    if (e instanceof TemplateNotFoundError) return null;
    throw e;
  }
}

async function describeAttachments(
  ctx: HandlerContext,
  refs: readonly MailAttachmentRef[],
): Promise<{ readonly attachments: PreviewAttachment[]; readonly missing: string[] }> {
  const fileRefIds = refs.flatMap((ref) => (ref.kind === "rendered-pdf" ? [] : [ref.fileRefId]));
  const rows =
    fileRefIds.length === 0
      ? []
      : await selectMany<{ id: string; size: number | bigint | string }>(ctx.db, fileRefsTable, {
          id: fileRefIds,
        });
  const sizeById = new Map(rows.map((row) => [row.id, Number(row.size)]));
  // An inline image is named by its content id because the stored file name is personal data and
  // may be ciphertext; a file attachment carries the name the admin gave it.
  const attachments = refs.map((ref) => previewAttachmentOf(ref, sizeById));
  // A fileRef without a row has no known size: it is reported, not counted as 0 bytes.
  const missing = refs.flatMap((ref, index) =>
    ref.kind !== "rendered-pdf" && !sizeById.has(ref.fileRefId)
      ? [attachments[index]?.name ?? ""]
      : [],
  );
  return { attachments, missing };
}

function previewAttachmentOf(
  ref: MailAttachmentRef,
  sizeById: ReadonlyMap<string, number>,
): PreviewAttachment {
  switch (ref.kind) {
    case "inline":
      return {
        kind: "inline",
        cid: ref.cid,
        name: ref.cid,
        sizeBytes: sizeById.get(ref.fileRefId) ?? 0,
      };
    case "file":
      return { kind: "file", name: ref.fileName, sizeBytes: sizeById.get(ref.fileRefId) ?? 0 };
    case "rendered-pdf":
      return { kind: "rendered-pdf", name: ref.fileName, templateSlug: ref.templateSlug };
  }
}

// Part headers and multipart boundary lines around one attachment in the MIME message.
export const MIME_PART_OVERHEAD_BYTES = 512;

// The provider cap applies to the encoded message: attachments travel base64-encoded.
export function encodedAttachmentBytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4 + MIME_PART_OVERHEAD_BYTES;
}

const attachmentSizeOf = (attachment: PreviewAttachment): number =>
  attachment.kind === "rendered-pdf" ? 0 : encodedAttachmentBytes(attachment.sizeBytes);

export function estimateMailBytes(args: {
  readonly html: string;
  readonly text: string;
  readonly attachments: readonly PreviewAttachment[];
}): number {
  return (
    utf8Bytes(args.html) +
    utf8Bytes(args.text) +
    args.attachments.reduce((sum, attachment) => sum + attachmentSizeOf(attachment), 0)
  );
}

// The row an editor is working on, whatever its status: the stored template only resolves when
// active, so a draft would otherwise lose the images and attachments uploaded to it.
async function loadEditedRowResources(
  ctx: HandlerContext,
  user: SessionUser,
  input: TemplatePreviewInput,
): Promise<Record<string, LinkedResourceEntry> | undefined> {
  const rows = await selectMany<TemplateResourceRow>(
    ctx.db,
    templateResourcesTable,
    { tenantId: user.tenantId, slug: input.slug, kind: "mail", locale: input.locale },
    { limit: 1 },
  );
  const row = rows[0];
  return row === undefined ? undefined : parseLinkedResourceEntries(row.linkedResources);
}

async function resolvePdfLayout(
  ctx: HandlerContext,
  user: SessionUser,
  slug: string,
  locale: string,
): Promise<PreviewLayout | null> {
  const api = createTemplateResolverApi(ctx.db);
  const find = async (tenantId: string): Promise<TemplateResource | null> => {
    try {
      return await api.resolveLayout({ tenantId, slug, kind: "pdf-layout", locale });
    } catch (e) {
      if (e instanceof TemplateNotFoundError) return null;
      throw e;
    }
  };
  let layout = await find(user.tenantId);
  let html = layout?.content ?? "";
  if (layout !== null && layout.scope !== "system") {
    // Re-checked like the mail renderer does: a tenant row that predates the write gate must not pass.
    const sanitized = sanitizeLayoutHtml(html);
    if (sanitized.ok) html = sanitized.html;
    else {
      layout = await find(SYSTEM_TENANT_ID);
      html = layout?.content ?? "";
    }
  }
  if (layout === null) return null;
  return { slug, scope: layout.scope, html, regions: readLayoutRegions(html) };
}

function missingResourceCheck(missing: readonly string[]): PreviewCheck {
  return {
    code: "resources_resolved",
    ok: missing.length === 0,
    i18nKey: "templateResolver.checks.resourcesResolved",
    params: { missing },
  };
}

function requiredPlaceholdersCheck(missing: readonly string[]): PreviewCheck {
  return {
    code: "required_placeholders",
    ok: missing.length === 0,
    i18nKey: "templateResolver.checks.requiredPlaceholders",
    params: { missing },
  };
}

function toRenderFailure(e: unknown): TemplatePreviewOutcome {
  if (!(e instanceof RendererError)) throw e;
  return failed(
    new UnprocessableError(TemplateResolverErrors.previewRenderFailed, {
      i18nKey: "templateResolver.errors.preview.renderFailed",
      details: { code: e.code },
    }),
  );
}

type DocumentPreviewArgs = {
  readonly input: TemplatePreviewInput;
  readonly content: string;
  readonly meta: ReturnType<typeof parseTemplateMeta>;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly sampleValues: Readonly<Record<string, unknown>>;
  readonly validation: ValidationResponse;
};

// Only a plugin that prints documents can show the filled-in page; without one the editor
// still gets the body and the raw layout, just without placeholder values.
function documentPreviewPlugin(ctx: HandlerContext, tenantId: string): RendererPlugin | null {
  try {
    const plugin = createRendererFoundationApi(
      collectRendererPlugins(ctx.registry),
    ).createRendererForTenant({ tenantId, kind: "document-pdf" });
    return plugin.previewDocument === undefined ? null : plugin;
  } catch (e) {
    if (e instanceof RendererError && e.code === "no_plugin_for_kind") return null;
    throw e;
  }
}

async function renderDocumentPreview(
  ctx: HandlerContext,
  user: SessionUser,
  args: DocumentPreviewArgs,
): Promise<TemplatePreviewOutcome> {
  const { input, content, meta, validation, sampleValues } = args;
  const pdfMeta = meta.ok ? readPdfTemplateMeta(meta.meta) : null;
  const requiredCheck = requiredPlaceholdersCheck(validation.missingRequired);
  const plugin = documentPreviewPlugin(ctx, user.tenantId);

  if (plugin?.previewDocument === undefined) {
    return {
      ok: true,
      mailAttachments: [],
      sender: {},
      preview: {
        kind: "document-pdf",
        subject: null,
        previewText: null,
        html: content,
        text: null,
        attachments: [],
        layout: await resolvePdfLayout(
          ctx,
          user,
          pdfMeta?.layoutSlug ?? DEFAULT_PDF_LAYOUT_SLUG,
          input.locale,
        ),
        sampleValues,
        checks: [missingResourceCheck(validation.warnings.map((w) => w.detail)), requiredCheck],
        validation,
      },
    };
  }

  let document: Awaited<ReturnType<NonNullable<RendererPlugin["previewDocument"]>>>;
  try {
    document = await plugin.previewDocument(
      {
        slug: input.slug,
        locale: input.locale,
        variables: sampleValues,
        draft: { content, meta: pdfMeta, variableSchema: args.variableSchema },
      },
      {
        db: ctx.db,
        registry: ctx.registry,
        tenantId: user.tenantId,
        ...(ctx.config !== undefined && { config: ctx.config }),
        filesForTenant: (fileTenantId) =>
          fileContextForTenant(ctx, ctx.user.tenantId, fileTenantId),
      },
    );
  } catch (e) {
    return toRenderFailure(e);
  }
  const layout = document.layout;
  return {
    ok: true,
    mailAttachments: [],
    sender: {},
    preview: {
      kind: "document-pdf",
      subject: null,
      previewText: null,
      html: document.bodyHtml,
      text: null,
      attachments: [],
      layout:
        layout === null
          ? null
          : {
              slug: layout.slug,
              scope: layout.scope,
              html: `${layout.headerHtml}${layout.signatureHtml}${layout.footerHtml}`,
              regions: {
                header: layout.headerHtml,
                signature: layout.signatureHtml,
                footer: layout.footerHtml,
              },
            },
      sampleValues,
      checks: [missingResourceCheck(document.missingResourceKeys), requiredCheck],
      validation,
    },
  };
}

export type DocumentDraftOutcome =
  | {
      readonly ok: true;
      readonly content: string;
      readonly meta: PdfTemplateMeta | null;
      readonly variableSchema: Readonly<Record<string, unknown>>;
      readonly sampleValues: Readonly<Record<string, unknown>>;
    }
  | { readonly ok: false; readonly error: KumikoError };

// The caller derives `scope` once from the role (SystemAdmin edits the system row), so the write
// gates and the print see the same row: a failing draft is rejected with the same problems as a save.
export async function evaluateDocumentDraft(
  ctx: HandlerContext,
  user: SessionUser,
  scope: TemplateWriteScope,
  draft: {
    readonly slug: string;
    readonly locale: string;
    readonly content: string;
    readonly meta?: unknown;
    readonly variableSchema: Readonly<Record<string, unknown>>;
  },
): Promise<DocumentDraftOutcome> {
  const { response, evaluation } = await validateTemplateDraft(ctx, user, {
    slug: draft.slug,
    kind: "document-pdf",
    contentFormat: "html",
    content: draft.content,
    meta: draft.meta,
    variableSchema: draft.variableSchema,
    locale: draft.locale,
    scope,
  });
  if (!evaluation.ok) {
    return { ok: false, error: new ValidationError({ fields: [...evaluation.issues] }) };
  }
  const meta = parseTemplateMeta("document-pdf", parseStoredJson(evaluation.metaJson));
  return {
    ok: true,
    content: evaluation.content ?? "",
    meta: meta.ok ? readPdfTemplateMeta(meta.meta) : null,
    variableSchema: draft.variableSchema,
    sampleValues: sampleValuesFor(response.variables, labelTextFor(ctx, draft.locale)),
  };
}

type DraftSource = {
  readonly content: string;
  readonly meta: unknown;
  readonly variableSchema: Readonly<Record<string, unknown>>;
};

// The posted draft when it carries content, else the stored template; null when none is stored.
async function resolveDraftSource(
  ctx: HandlerContext,
  user: SessionUser,
  input: TemplatePreviewInput,
): Promise<DraftSource | null> {
  if (input.content !== undefined) {
    return { content: input.content, meta: input.meta, variableSchema: input.variableSchema };
  }
  const stored = await loadStoredDraft(ctx, user, input);
  if (stored === null) return null;
  return { content: stored.content, meta: stored.meta, variableSchema: stored.variableSchema };
}

async function renderMailPreview(
  ctx: HandlerContext,
  user: SessionUser,
  args: DocumentPreviewArgs,
): Promise<TemplatePreviewOutcome> {
  const {
    input,
    content,
    meta,
    validation,
    sampleValues,
    variableSchema: draftVariableSchema,
  } = args;
  if (!meta.ok || !isMailTemplateMeta(meta.meta)) {
    return failed(
      new UnprocessableError(TemplateResolverErrors.previewRenderFailed, {
        i18nKey: "templateResolver.errors.preview.renderFailed",
        details: { code: "invalid_meta" },
      }),
    );
  }
  const mailMeta: MailTemplateMeta = meta.meta;
  const editedResources =
    input.content === undefined ? undefined : await loadEditedRowResources(ctx, user, input);
  let rendered: Awaited<ReturnType<ReturnType<typeof createTemplateMailRenderer>>>;
  try {
    rendered = await createTemplateMailRenderer(
      ctx.db,
      ctx.registry,
      user.tenantId,
      ctx.config,
    )({
      slug: input.slug,
      locale: input.locale,
      variables: sampleValues,
      draft: {
        content,
        meta: mailMeta,
        variableSchema: draftVariableSchema,
        ...(editedResources !== undefined && { linkedResources: editedResources }),
      },
    });
  } catch (e) {
    return toRenderFailure(e);
  }

  const mailAttachments = rendered.attachments ?? [];
  const inline = mailAttachments.filter((ref) => ref.kind === "inline");
  const { attachments, missing: missingAttachments } = await describeAttachments(
    ctx,
    mailAttachments,
  );
  const displayHtml = await buildDisplayHtml(
    rendered.html,
    inline,
    createEmailAttachmentReader(ctx.db, ctx.registry, user.tenantId, ctx.config, (tenantId) =>
      fileContextForTenant(ctx, ctx.user.tenantId, tenantId),
    ),
  );
  const resolvedCids = new Set(inline.map((ref) => ref.cid));
  const unresolved = collectDocumentResourceKeys(content).filter((key) => !resolvedCids.has(key));
  const totalBytes = estimateMailBytes({ html: rendered.html, text: rendered.text, attachments });
  return {
    ok: true,
    mailAttachments,
    sender: {
      ...(rendered.fromName !== undefined && { fromName: rendered.fromName }),
      ...(rendered.replyTo !== undefined && { replyTo: rendered.replyTo }),
    },
    preview: {
      kind: "mail",
      subject: rendered.subject,
      previewText: rendered.previewText ?? null,
      html: rendered.html,
      displayHtml,
      text: rendered.text,
      attachments,
      layout: null,
      mailLayout:
        rendered.layout === undefined
          ? null
          : {
              slug: mailMeta.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG,
              scope: rendered.layout.scope,
              version: rendered.layout.templateVersion,
            },
      sampleValues,
      checks: [
        missingResourceCheck([...unresolved, ...missingAttachments]),
        {
          code: "text_present",
          ok: rendered.text.trim() !== "",
          i18nKey: "templateResolver.checks.textPresent",
        },
        {
          code: "size_under_cap",
          ok: totalBytes <= MAIL_PREVIEW_MAX_BYTES,
          i18nKey: "templateResolver.checks.sizeUnderCap",
          params: { totalBytes, maxBytes: MAIL_PREVIEW_MAX_BYTES },
        },
        requiredPlaceholdersCheck(validation.missingRequired),
      ],
      validation,
    },
  };
}

// Renders a draft (or, without content, the stored template) with sample values, going through
// the same write gates and the same mail renderer as a real send. Nothing is stored or sent.
export async function renderTemplatePreview(
  ctx: HandlerContext,
  user: SessionUser,
  input: TemplatePreviewInput,
): Promise<TemplatePreviewOutcome> {
  const draftSource = await resolveDraftSource(ctx, user, input);
  if (draftSource === null) return failed(new NotFoundError("template-resource", input.slug));
  const {
    content: draftContent,
    meta: draftMeta,
    variableSchema: draftVariableSchema,
  } = draftSource;

  const { response: validation, evaluation } = await validateTemplateDraft(ctx, user, {
    slug: input.slug,
    kind: input.kind,
    contentFormat: "html",
    content: draftContent,
    meta: draftMeta,
    variableSchema: draftVariableSchema,
    locale: input.locale,
    scope: "tenant",
  });
  if (!evaluation.ok) return failed(new ValidationError({ fields: [...evaluation.issues] }));

  const content = evaluation.content ?? "";
  const meta = parseTemplateMeta(input.kind, parseStoredJson(evaluation.metaJson));
  const sampleValues = sampleValuesFor(validation.variables, labelTextFor(ctx, input.locale));

  if (input.kind === "document-pdf") {
    return renderDocumentPreview(ctx, user, {
      input,
      content,
      meta,
      variableSchema: draftVariableSchema,
      sampleValues,
      validation,
    });
  }

  return renderMailPreview(ctx, user, {
    input,
    content,
    meta,
    variableSchema: draftVariableSchema,
    sampleValues,
    validation,
  });
}
