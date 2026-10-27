import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type PageRow, pagesTable } from "../table.ts";
import { sanitizePageBody } from "./page-body-issues.ts";

type PageWriteHandler = WriteHandlerDef["handler"];
type PageWriteContext = Parameters<PageWriteHandler>[1];

type Guarded =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly issues: FieldIssue[] };

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// preSave hooks cannot report field errors (the executor maps every throw to
// presave_hook_failed), so the convention handlers are checked before they run.
// An update may touch only body or only bodyFormat, so the pair is completed
// from the stored row. A document body is handed on as the rebuilt html.
async function guardUpdate(payload: unknown, ctx: PageWriteContext): Promise<Guarded> {
  if (!isPlainObject(payload) || !isPlainObject(payload["changes"])) return { ok: true, payload };
  const changes = payload["changes"];
  if (!("body" in changes) && !("bodyFormat" in changes)) return { ok: true, payload };
  const id = payload["id"];
  const stored =
    typeof id === "string" ? await fetchOne<PageRow>(ctx.db, pagesTable, { id }) : null;
  const body = "body" in changes ? stringOrNull(changes["body"]) : (stored?.body ?? null);
  const format = "bodyFormat" in changes ? changes["bodyFormat"] : stored?.bodyFormat;
  const result = sanitizePageBody(body, format);
  if (!result.ok) return result;
  return { ok: true, payload: { ...payload, changes: { ...changes, body: result.body } } };
}

function guardCreate(payload: unknown): Guarded {
  if (!isPlainObject(payload)) return { ok: true, payload };
  const result = sanitizePageBody(stringOrNull(payload["body"]), payload["bodyFormat"]);
  if (!result.ok) return result;
  return { ok: true, payload: { ...payload, body: result.body } };
}

export function withBodyValidation(
  def: WriteHandlerDef,
  verb: "create" | "update",
): WriteHandlerDef {
  return {
    ...def,
    handler: async (event, ctx) => {
      const guarded =
        verb === "create" ? guardCreate(event.payload) : await guardUpdate(event.payload, ctx);
      if (!guarded.ok) return writeFailure(new ValidationError({ fields: guarded.issues }));
      return def.handler({ ...event, payload: guarded.payload }, ctx);
    },
  };
}
