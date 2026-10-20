import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf, isRowServedTo } from "../template-delivery-policy.ts";
import { isHiddenSystemDraft, toWorkingRow } from "../template-draft.ts";
import { isSystemOnlyTemplateHiddenFrom } from "../template-system-only.ts";
import type { DocumentHtmlKind } from "../web/constants.ts";
import { parseStoredJson } from "./template-gates.ts";

export type DocumentBase = {
  readonly scope: "tenant" | "system";
  /** The stored row's own version, which counts every draft save. */
  readonly version: number;
};

export type LoadedDocument = {
  readonly rowId: string;
  readonly base: DocumentBase;
  readonly status: string;
  readonly content: string;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly title: string | null;
  readonly folder: string | null;
  readonly parentTemplateId: string | null;
};

function recordOrEmpty(raw: string | null): Readonly<Record<string, unknown>> {
  const parsed = parseStoredJson(raw);
  return isPlainObject(parsed) ? parsed : {};
}

// The version an editor works on: the caller's own row (its open draft if there is one),
// else the served system default. A system default as base is what a patch copies into a tenant draft.
export async function loadDocumentBase(
  ctx: HandlerContext,
  user: SessionUser,
  where: { readonly slug: string; readonly kind: DocumentHtmlKind; readonly locale: string },
): Promise<LoadedDocument | null> {
  const own = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
    tenantId: user.tenantId,
    ...where,
  });
  // A locked override is neither shown nor edited by a non-SystemAdmin; the served system default is.
  const ownIsVisible =
    own !== undefined &&
    !isSystemOnlyTemplateHiddenFrom(user, ctx.registry, own) &&
    isRowServedTo(deliveryPolicyOf(ctx.registry), user, own);
  if (own !== undefined && ownIsVisible) {
    const working = toWorkingRow(own, user.tenantId);
    return {
      rowId: String(own.id),
      base: { scope: own.scope === "system" ? "system" : "tenant", version: own.version },
      status: working.status,
      content: working.content ?? "",
      meta: recordOrEmpty(working.meta),
      variableSchema: recordOrEmpty(working.variableSchema),
      title: working.title,
      folder: working.folder,
      parentTemplateId: working.parentTemplateId,
    };
  }
  const system = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    scope: "system",
    status: "active",
    ...where,
  });
  if (
    system === undefined ||
    isHiddenSystemDraft(user, system) ||
    isSystemOnlyTemplateHiddenFrom(user, ctx.registry, system)
  ) {
    return null;
  }
  return {
    rowId: String(system.id),
    base: { scope: "system", version: system.version },
    status: system.status,
    content: system.content ?? "",
    meta: recordOrEmpty(system.meta),
    variableSchema: recordOrEmpty(system.variableSchema),
    title: system.title,
    folder: system.folder,
    parentTemplateId: String(system.id),
  };
}
