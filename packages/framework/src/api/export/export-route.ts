import { Hono } from "hono";
import * as z from "zod";
import type { Registry } from "../../engine/types/index.ts";
import { toKumikoError } from "../../errors/index.ts";
import { createI18n, DEFAULT_LOCALE } from "../../i18n/index.ts";
import type { Dispatcher } from "../../pipeline/dispatcher.ts";
import { isValidIanaTimeZone } from "../../time/index.ts";
import { Routes } from "../api-constants.ts";
import { getUser } from "../auth-middleware.ts";
import { requestContext } from "../request-context.ts";
import { assertPayloadDepthAllowed, queryErrorResponse } from "../routes.ts";
import { EXPORT_TOO_MANY_I18N_KEY, exportRejection } from "./export-errors.ts";
import { readExportRows } from "./export-rows.ts";
import { resolveExportPlan } from "./export-screen.ts";
import { writeExportWorkbook } from "./export-xlsx-writer.ts";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_ID_LENGTH = 200;

const exportBodySchema = z.object({
  screen: z.string().max(MAX_ID_LENGTH),
  payload: z.record(z.string(), z.unknown()).default({}),
  columns: z.array(z.string().max(MAX_ID_LENGTH)).min(1).max(MAX_ID_LENGTH),
  timeZone: z.string().max(64).optional(),
});

// Browser zone first (what the user saw in the list), then the profile zone, else UTC.
function exportTimeZone(requested: string | undefined, profile: string | undefined): string {
  for (const candidate of [requested, profile]) {
    if (candidate !== undefined && isValidIanaTimeZone(candidate)) return candidate;
  }
  return "UTC";
}

function downloadFileName(screenShortId: string, now: Date): string {
  const safeId = screenShortId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${safeId}-${now.toISOString().slice(0, 10)}.xlsx`;
}

export function createExportRoutes(dispatcher: Dispatcher, registry: Registry) {
  const api = new Hono();
  const i18n = createI18n(registry, { defaultLocale: DEFAULT_LOCALE });

  api.post(Routes.exportXlsx, async (c) => {
    const user = getUser(c);
    try {
      const parsed = exportBodySchema.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) throw exportRejection("export_invalid_request", "body");
      const body = parsed.data;
      assertPayloadDepthAllowed(body.payload);
      const plan = resolveExportPlan(registry, body.screen, body.columns, user);
      const result = await readExportRows(dispatcher, plan, body.payload, user);
      if (result.tooMany) {
        return c.json(
          {
            error: {
              code: "export_too_many_rows",
              httpStatus: 413,
              message: `export exceeds the limit of ${plan.maxRows} rows; narrow the filter`,
              i18nKey: EXPORT_TOO_MANY_I18N_KEY,
              details: { maxRows: plan.maxRows },
            },
          },
          413,
        );
      }
      const locale = requestContext.get()?.locale ?? DEFAULT_LOCALE;
      const bytes = await writeExportWorkbook(
        plan.columns,
        result.rows,
        (key) => i18n.t(key, locale),
        exportTimeZone(body.timeZone, user.timezone),
      );
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": XLSX_CONTENT_TYPE,
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${downloadFileName(plan.screenShortId, new Date())}"`,
        },
      });
    } catch (e) {
      return queryErrorResponse(c, toKumikoError(e), Routes.exportXlsx);
    }
  });

  return api;
}
