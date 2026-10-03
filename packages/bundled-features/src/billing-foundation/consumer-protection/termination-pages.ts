// Public § 312k pages (/legal/kuendigen, /legal/cancel): form → review → confirm,
// no JavaScript. Every echoed value goes through escapeHtml/escapeHtmlAttr.

import type { AnonymousExtraRoute } from "@cosmicdrift/kumiko-framework/api";
import { escapeHtml, escapeHtmlAttr } from "@cosmicdrift/kumiko-headless";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  type PublicPageWrapLayout,
  redirectToCanonicalPath,
  securePageHeaders,
  slashVariantOf,
  wrapInLayout,
} from "../../page-render/index.js";
import { SubscriptionFoundationHandlers } from "../constants.js";
import { CONTRACT_TERMINATION_DECLARATION_TYPES, CONTRACT_TERMINATION_KINDS } from "../events.js";
import type { ConsentLocale } from "./consent-text.js";
import { formatReceivedAt } from "./termination-mail.js";
import { requestContractTerminationSchema } from "./termination-request.js";
import { type PageTexts, TERMINATION_TEXTS } from "./termination-texts.js";

export type ContractTerminationRoutesOptions = {
  readonly paths?: Readonly<Partial<Record<ConsentLocale, string>>>;
  /** Layout around every page (form, review, result, 429, error). Default:
   *  the minimal `wrapInLayout` skeleton. The page headers (CSP with
   *  `script-src 'none'`, framing, no-store) stay with the framework, so the
   *  layout must work without JavaScript and only returns the HTML string. */
  readonly wrapLayout?: PublicPageWrapLayout;
};

const PAGE_SLUG = "contract-termination";

// Everything a page render needs besides its own content.
type PageContext = {
  readonly locale: ConsentLocale;
  readonly path: string;
  readonly wrapLayout: PublicPageWrapLayout;
  readonly alternates: Readonly<Record<ConsentLocale, string>>;
};

const DEFAULT_PATHS: Readonly<Record<ConsentLocale, string>> = {
  de: "/legal/kuendigen",
  en: "/legal/cancel",
};

const FORM_FIELDS = [
  "declarationType",
  "terminationKind",
  "name",
  "email",
  "customerReference",
  "reason",
] as const;
type FormField = (typeof FORM_FIELDS)[number];
type FormValues = Readonly<Record<FormField, string>>;

const EMPTY_TEXT = "";

const EMPTY_FORM: FormValues = {
  declarationType: "termination",
  terminationKind: "ordinary",
  name: "",
  email: "",
  customerReference: "",
  reason: EMPTY_TEXT,
};

// The shared security headers leave framing to SAMEORIGIN; this form must
// never be framed (clickjacking a "cancel now" button).
function pageHeaders(): Record<string, string> {
  const headers = securePageHeaders({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  return {
    ...headers,
    "content-security-policy": `${headers["content-security-policy"] ?? ""}; frame-ancestors 'none'; form-action 'self'`,
    "x-frame-options": "DENY",
  };
}

function htmlResponse(
  ctx: PageContext,
  title: string,
  bodyHtml: string,
  status: 200 | 400 | 429,
): Response {
  const root = `<div data-kumiko-page="${PAGE_SLUG}">\n${bodyHtml}\n</div>`;
  return new Response(
    ctx.wrapLayout({
      title,
      bodyHtml: root,
      lang: ctx.locale,
      slug: PAGE_SLUG,
      alternates: ctx.alternates,
    }),
    { status, headers: pageHeaders() },
  );
}

function isOneOf<T extends string>(options: readonly T[], value: string): value is T {
  return (options as readonly string[]).includes(value);
}

async function readForm(c: Context): Promise<{ step: string; values: FormValues }> {
  const body = await c.req.parseBody();
  const text = (key: string): string => {
    const value = body[key];
    return typeof value === "string" ? value : "";
  };
  return {
    step: text("step"),
    values: {
      declarationType: text("declarationType"),
      terminationKind: text("terminationKind"),
      name: text("name").trim(),
      email: text("email").trim(),
      customerReference: text("customerReference").trim(),
      reason: text("reason").trim(),
    },
  };
}

function payloadOf(values: FormValues, locale: ConsentLocale): Record<string, string> {
  return {
    declarationType: values.declarationType,
    terminationKind: values.terminationKind,
    name: values.name,
    email: values.email,
    locale,
    ...(values.customerReference !== "" && { customerReference: values.customerReference }),
    ...(values.reason !== "" && { reason: values.reason }),
  };
}

function validationMessages(values: FormValues, locale: ConsentLocale): readonly string[] {
  const parsed = requestContractTerminationSchema.safeParse(payloadOf(values, locale));
  if (parsed.success) return [];
  const page = TERMINATION_TEXTS[locale].page;
  const byField: Readonly<Record<string, string>> = {
    name: page.errorName,
    email: page.errorEmail,
    reason: page.errorReason,
    declarationType: page.errorChoice,
    terminationKind: page.errorChoice,
  };
  return [
    ...new Set(
      parsed.error.issues.map((issue) => byField[String(issue.path[0])] ?? page.errorGeneric),
    ),
  ];
}

function errorsHtml(messages: readonly string[], page: PageTexts): string {
  if (messages.length === 0) return "";
  return `<div role="alert"><h2>${escapeHtml(page.errorsHeading)}</h2><ul>${messages
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("")}</ul></div>`;
}

function radioGroup<T extends string>(
  name: FormField,
  options: readonly T[],
  labels: Readonly<Record<T, string>>,
  selected: string,
): string {
  return options
    .map(
      (option) =>
        `<label><input type="radio" name="${name}" value="${escapeHtmlAttr(option)}"${
          option === selected ? " checked" : ""
        }> ${escapeHtml(labels[option])}</label><br>`,
    )
    .join("");
}

function textField(
  name: FormField,
  label: string,
  value: string,
  attributes: { readonly type?: string; readonly required?: boolean; readonly maxlength: number },
): string {
  return `<p data-kumiko-field-group="${name}"><label>${escapeHtml(label)}<br><input type="${escapeHtmlAttr(attributes.type ?? "text")}" name="${name}" value="${escapeHtmlAttr(value)}" maxlength="${attributes.maxlength}"${
    attributes.required ? " required" : ""
  }></label></p>`;
}

function formPage(
  ctx: PageContext,
  values: FormValues,
  messages: readonly string[],
  status: 200 | 400,
): Response {
  const { locale, path } = ctx;
  const texts = TERMINATION_TEXTS[locale];
  const { page } = texts;
  const body = `<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.lead)}</p>
${errorsHtml(messages, page)}
<form method="post" action="${escapeHtmlAttr(path)}" data-kumiko-form="contract-termination">
<input type="hidden" name="step" value="review">
<fieldset data-kumiko-field-group="declarationType"><legend>${escapeHtml(page.declarationTypeHeading)}</legend>${radioGroup(
    "declarationType",
    CONTRACT_TERMINATION_DECLARATION_TYPES,
    texts.declarationTypeLabel,
    values.declarationType,
  )}</fieldset>
<fieldset data-kumiko-field-group="terminationKind"><legend>${escapeHtml(page.kindHeading)}</legend>${radioGroup(
    "terminationKind",
    CONTRACT_TERMINATION_KINDS,
    texts.terminationKindLabel,
    values.terminationKind,
  )}<p>${escapeHtml(page.earliestDate)}</p></fieldset>
${textField("name", page.nameLabel, values.name, { required: true, maxlength: 200 })}
${textField("email", page.emailLabel, values.email, { type: "email", required: true, maxlength: 254 })}
${textField("customerReference", page.customerReferenceLabel, values.customerReference, { maxlength: 200 })}
<p data-kumiko-field-group="reason"><label>${escapeHtml(page.reasonLabel)} (${escapeHtml(page.reasonHint)})<br><textarea name="reason" rows="5" maxlength="2000">${escapeHtml(values.reason)}</textarea></label></p>
<p><button type="submit" data-kumiko-button="review">${escapeHtml(page.reviewButton)}</button></p>
</form>`;
  return htmlResponse(ctx, page.title, body, status);
}

function hiddenInputs(values: FormValues): string {
  return FORM_FIELDS.map(
    (field) => `<input type="hidden" name="${field}" value="${escapeHtmlAttr(values[field])}">`,
  ).join("\n");
}

function reviewPage(ctx: PageContext, values: FormValues): Response {
  const { locale, path } = ctx;
  const texts = TERMINATION_TEXTS[locale];
  const { page } = texts;
  // validationMessages already proved the enum values.
  const declarationType = isOneOf(CONTRACT_TERMINATION_DECLARATION_TYPES, values.declarationType)
    ? values.declarationType
    : "termination";
  const terminationKind = isOneOf(CONTRACT_TERMINATION_KINDS, values.terminationKind)
    ? values.terminationKind
    : "ordinary";
  const row = (label: string, value: string): string =>
    value === ""
      ? ""
      : `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  const body = `<h1>${escapeHtml(page.reviewTitle)}</h1>
<p>${escapeHtml(page.reviewLead)}</p>
<table data-kumiko-review-table>
${row(texts.declarationType, texts.declarationTypeLabel[declarationType])}
${row(texts.terminationKind, texts.terminationKindLabel[terminationKind])}
${row(texts.name, values.name)}
${row(texts.email, values.email)}
${row(texts.customerReference, values.customerReference)}
${row(texts.reasonFieldLabel, values.reason)}
</table>
<form method="post" action="${escapeHtmlAttr(path)}" data-kumiko-form="contract-termination-review">
${hiddenInputs(values)}
<button type="submit" name="step" value="confirm" data-kumiko-button="confirm">${escapeHtml(page.confirmButton[declarationType])}</button>
<button type="submit" name="step" value="edit" data-kumiko-button="back">${escapeHtml(page.backButton)}</button>
</form>`;
  return htmlResponse(ctx, page.reviewTitle, body, 200);
}

function resultPage(ctx: PageContext, receivedAtIso: string, requestId: string): Response {
  const { locale } = ctx;
  const { page } = TERMINATION_TEXTS[locale];
  const body = `<h1>${escapeHtml(page.resultTitle)}</h1>
<p>${escapeHtml(page.resultLead)}</p>
<p>${escapeHtml(page.resultReceivedAt)}: <strong>${escapeHtml(formatReceivedAt(receivedAtIso, locale))}</strong></p>
<p>${escapeHtml(page.resultRequestId)}: <code>${escapeHtml(requestId)}</code></p>
<p>${escapeHtml(page.resultMailNote)}</p>`;
  return htmlResponse(ctx, page.resultTitle, body, 200);
}

type WriteResponseBody = {
  readonly isSuccess?: boolean;
  readonly data?: { readonly requestId?: unknown; readonly receivedAtIso?: unknown };
  readonly error?: { readonly code?: unknown };
};

const RATE_LIMITED_CODE = "rate_limited";

const TENANT_HEADER = "x-tenant";
const TENANT_COOKIE = "kumiko_tenant";
// Exactly what the anonymous tenant resolution reads. The resolver and its
// trust rules still decide; the re-entry only sees what a direct /api/write
// from this client would see. Never the session cookie or Authorization (the
// handler is anonymous) and never X-Forwarded-For (the resolved clientIp
// travels as env).
const FORWARDED_TENANT_HEADERS = [
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
  TENANT_HEADER,
] as const;

function reentryHeaders(c: Context): Headers {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of FORWARDED_TENANT_HEADERS) {
    const value = c.req.header(name);
    if (value !== undefined) headers.set(name, value);
  }
  const tenantCookie = getCookie(c, TENANT_COOKIE);
  if (tenantCookie !== undefined) {
    headers.set("cookie", `${TENANT_COOKIE}=${encodeURIComponent(tenantCookie)}`);
  }
  return headers;
}

async function submitDeclaration(
  c: Context,
  app: { fetch: (request: Request, env?: unknown) => Response | Promise<Response> },
  clientIp: string,
  values: FormValues,
  locale: ConsentLocale,
): Promise<
  | { readonly kind: "received"; readonly requestId: string; readonly receivedAtIso: string }
  | { readonly kind: "rate-limited" }
  | { readonly kind: "failed" }
> {
  // deps.write only resolves a session user under /api/*; this page lives
  // outside it, so it re-enters the dispatcher through the app like the
  // user-export by-token route. The resolved clientIp as env keeps the
  // handler's per-IP rate limit per visitor instead of one shared bucket;
  // the forwarded host headers let a host-based tenant resolver see this
  // visitor's host.
  const response = await app.fetch(
    new Request(`${new URL(c.req.url).origin}/api/write`, {
      method: "POST",
      headers: reentryHeaders(c),
      body: JSON.stringify({
        type: SubscriptionFoundationHandlers.requestContractTermination,
        payload: payloadOf(values, locale),
      }),
    }),
    clientIp,
  );
  const parsed: WriteResponseBody | null = await response.json().catch(() => null);
  if (response.status === 429 || parsed?.error?.code === RATE_LIMITED_CODE) {
    return { kind: "rate-limited" };
  }
  const requestId = parsed?.data?.requestId;
  const receivedAtIso = parsed?.data?.receivedAtIso;
  if (
    response.ok &&
    parsed?.isSuccess === true &&
    typeof requestId === "string" &&
    typeof receivedAtIso === "string"
  ) {
    return { kind: "received", requestId, receivedAtIso };
  }
  return { kind: "failed" };
}

function routesFor(ctx: PageContext): AnonymousExtraRoute[] {
  const { locale, path } = ctx;
  const slashVariant = slashVariantOf(path);
  return [
    {
      method: "GET",
      path,
      entry: "anonymous",
      handler: () => formPage(ctx, EMPTY_FORM, [], 200),
    },
    // GET also serves HEAD; POST gets no alias (a redirect would drop the body).
    ...(slashVariant === null
      ? []
      : [
          {
            method: "GET" as const,
            path: slashVariant,
            entry: "anonymous" as const,
            handler: (c: Context) => redirectToCanonicalPath(c.req.url, path),
          },
        ]),
    {
      method: "POST",
      path,
      entry: "anonymous",
      handler: async (c, deps) => {
        const { step, values } = await readForm(c);
        if (step === "edit") return formPage(ctx, values, [], 200);
        const messages = validationMessages(values, locale);
        if (messages.length > 0) return formPage(ctx, values, messages, 400);
        if (step !== "confirm") return reviewPage(ctx, values);

        const outcome = await submitDeclaration(c, deps.app, deps.clientIp, values, locale);
        const { page } = TERMINATION_TEXTS[locale];
        if (outcome.kind === "received") {
          return resultPage(ctx, outcome.receivedAtIso, outcome.requestId);
        }
        if (outcome.kind === "rate-limited") {
          return htmlResponse(
            ctx,
            page.rateLimitedTitle,
            `<h1>${escapeHtml(page.rateLimitedTitle)}</h1><p>${escapeHtml(page.rateLimitedBody)}</p>`,
            429,
          );
        }
        return formPage(ctx, values, [page.errorGeneric], 400);
      },
    },
  ];
}

/** GET + POST pages for de (`/legal/kuendigen`) and en (`/legal/cancel`);
 *  mount via the app's `extraRoutes`. The other trailing-slash form of each
 *  path 301-redirects (GET/HEAD) to the configured path. */
export function createContractTerminationRoutes(
  options: ContractTerminationRoutesOptions = {},
): AnonymousExtraRoute[] {
  const alternates: Readonly<Record<ConsentLocale, string>> = {
    de: options.paths?.de ?? DEFAULT_PATHS.de,
    en: options.paths?.en ?? DEFAULT_PATHS.en,
  };
  const wrapLayout = options.wrapLayout ?? wrapInLayout;
  return (["de", "en"] as const).flatMap((locale) =>
    routesFor({ locale, path: alternates[locale], wrapLayout, alternates }),
  );
}
