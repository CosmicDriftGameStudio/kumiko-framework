import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type PageRow, pagesTable } from "../table.ts";
import { pageBodyIssues } from "./page-body-issues.ts";

type PageWriteHandler = WriteHandlerDef["handler"];
type PageWriteContext = Parameters<PageWriteHandler>[1];

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// preSave hooks cannot report field errors (the executor maps every throw to
// presave_hook_failed), so the convention handlers are checked before they run.
// An update may touch only body or only bodyFormat, so the pair is completed
// from the stored row.
async function updateIssues(payload: unknown, ctx: PageWriteContext) {
  if (!isPlainObject(payload) || !isPlainObject(payload["changes"])) return [];
  const changes = payload["changes"];
  if (!("body" in changes) && !("bodyFormat" in changes)) return [];
  const id = payload["id"];
  const stored =
    typeof id === "string" ? await fetchOne<PageRow>(ctx.db, pagesTable, { id }) : null;
  const body = "body" in changes ? stringOrNull(changes["body"]) : (stored?.body ?? null);
  const format = "bodyFormat" in changes ? changes["bodyFormat"] : stored?.bodyFormat;
  return pageBodyIssues(body, format);
}

function createIssues(payload: unknown) {
  if (!isPlainObject(payload)) return [];
  return pageBodyIssues(stringOrNull(payload["body"]), payload["bodyFormat"]);
}

export function withBodyValidation(
  def: WriteHandlerDef,
  verb: "create" | "update",
): WriteHandlerDef {
  return {
    ...def,
    handler: async (event, ctx) => {
      const issues =
        verb === "create" ? createIssues(event.payload) : await updateIssues(event.payload, ctx);
      if (issues.length > 0) return writeFailure(new ValidationError({ fields: issues }));
      return def.handler(event, ctx);
    },
  };
}
