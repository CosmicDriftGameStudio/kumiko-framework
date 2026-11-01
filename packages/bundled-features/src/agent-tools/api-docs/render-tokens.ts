import { patAuthRejectHttpStatus } from "@cosmicdrift/kumiko-framework/api";
import { frameworkErrorHttpStatus } from "@cosmicdrift/kumiko-framework/errors";
import {
  PAT_DEFAULT_EXPIRES_IN_DAYS,
  PAT_MAX_EXPIRES_IN_DAYS,
} from "../../personal-access-tokens/index.ts";
import { curlExample } from "./curl.ts";
import { codeSpan, fenced, pageBuilder, type RenderedPage, table } from "./markdown.ts";
import type { ApiDocsModel } from "./model.ts";
import { exampleHandler } from "./render-overview.ts";
import { tokensSectionIds as ids } from "./section-ids.ts";
import { type ApiDocsTexts, formatApiDocsText } from "./texts/index.ts";

export type TokensInput = {
  readonly model: ApiDocsModel;
  readonly locale: string;
  readonly texts: ApiDocsTexts;
  readonly baseUrl: string;
  readonly appName: string;
  readonly planNote: string | undefined;
};

function scopeTable(input: TokensInput): string {
  const [scope, grant, handlers] = input.texts.text["tokens.scopes.columns"].split(" | ");
  const rows = input.model.scopes.flatMap((entry) =>
    (entry.hasWriteLevel ? (["read", "write"] as const) : (["read"] as const)).map((level) => [
      `${codeSpan(entry.domain)} (${entry.label})`,
      codeSpan(`${entry.domain}:${level}`),
      entry.handlers
        .filter((handler) => handler.grant === level)
        .map((handler) => codeSpan(handler.qn))
        .join(", "),
    ]),
  );
  return table([scope ?? "", grant ?? "", handlers ?? ""], rows);
}

function errorTable(input: TokensInput): string {
  const text = input.texts.text;
  const [status, code, cause] = text["tokens.errors.columns"].split(" | ");
  const rows: { status: number; code: string; cause: string }[] = [
    {
      status: patAuthRejectHttpStatus.missing_token,
      code: "missing_token",
      cause: text["tokens.errors.missing"],
    },
    {
      status: patAuthRejectHttpStatus.invalid_token,
      code: "invalid_token",
      cause: text["tokens.errors.invalid"],
    },
    {
      status: frameworkErrorHttpStatus.access_denied,
      code: "access_denied",
      cause: text["tokens.errors.scope"],
    },
    {
      status: frameworkErrorHttpStatus.access_denied,
      code: "access_denied",
      cause: text["tokens.errors.route"],
    },
    {
      status: patAuthRejectHttpStatus.pat_rate_limited,
      code: "pat_rate_limited",
      cause: text["tokens.errors.rate"],
    },
    ...(input.model.toggleable
      ? [
          {
            status: frameworkErrorHttpStatus.feature_disabled,
            code: "feature_disabled",
            cause: text["tokens.errors.disabled"],
          },
        ]
      : []),
  ];
  return table(
    [status ?? "", code ?? "", cause ?? ""],
    rows.map((row) => [String(row.status), codeSpan(row.code), row.cause]),
  );
}

export function renderTokens(input: TokensInput): RenderedPage {
  const { model, texts, locale, appName } = input;
  const text = texts.text;
  const example = exampleHandler(model.handlers);
  const menuPath = model.menuPath[locale] ?? "";
  const page = pageBuilder(
    text["tokens.title"],
    formatApiDocsText(text["tokens.description"], { appName }),
  );
  page.add(formatApiDocsText(text["tokens.intro"], { appName }));
  page.section(ids.create, text["tokens.create.heading"]);
  page.add(
    [
      formatApiDocsText(text["tokens.create.step1"], { menuPath }),
      formatApiDocsText(text["tokens.create.step2"], {
        createLabel: model.createLabel[locale] ?? "",
      }),
      text["tokens.create.step3"],
      text["tokens.create.step4"],
    ]
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n"),
    formatApiDocsText(text["tokens.expiry"], {
      defaultDays: PAT_DEFAULT_EXPIRES_IN_DAYS,
      maxDays: PAT_MAX_EXPIRES_IN_DAYS,
    }),
  );
  page.section(ids.use, text["tokens.use.heading"]);
  page.add(
    text["tokens.use.body"],
    ...(example === undefined ? [] : [fenced("bash", curlExample(example, input.baseUrl))]),
  );
  page.section(ids.scopes, text["tokens.scopes.heading"]);
  page.add(text["tokens.scopes.intro"], scopeTable(input));
  page.section(ids.rateLimit, text["tokens.rateLimit.heading"]);
  page.add(
    formatApiDocsText(text["tokens.rateLimit"], {
      max: model.rateLimit.maxRequests,
      windowSeconds: model.rateLimit.windowMs / 1000,
    }),
    ...(input.planNote === undefined ? [] : [input.planNote]),
  );
  page.section(ids.errors, text["tokens.errors.heading"]);
  page.add(errorTable(input));
  page.section(ids.revoke, text["tokens.revoke.heading"]);
  page.add(formatApiDocsText(text["tokens.revoke.body"], { menuPath }));
  page.section(ids.security, text["tokens.security.heading"]);
  page.add(
    [text["tokens.security.item1"], text["tokens.security.item2"], text["tokens.security.item3"]]
      .map((item) => `- ${item}`)
      .join("\n"),
  );
  return page.finish();
}
