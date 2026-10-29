import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type FeatureRegistrar,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import type { BootCheckContext } from "@cosmicdrift/kumiko-types/feature";
import { documentIdForFile } from "./aggregate-id.ts";
import type { DOCUMENTS_FEATURE_NAME } from "./constants.ts";
import { ensureDocumentLink, type LinkTarget } from "./ensure-link.ts";
import type { DocumentExecutors } from "./executor.ts";

// Files saved into `entity.field` become documents of `category`, linked to the saved record
// itself (when it is a link target) and to `links(row)`.
export type DocumentCaptureRule = {
  readonly entity: string;
  readonly field: string;
  readonly category: string;
  readonly title?: (row: Readonly<Record<string, unknown>>) => string;
  readonly links?: (row: Readonly<Record<string, unknown>>) => readonly LinkTarget[];
};

const MAX_TITLE_LENGTH = 200;

async function captureFile(
  executors: DocumentExecutors,
  rule: DocumentCaptureRule,
  linkTargets: readonly string[],
  saved: { readonly id: string; readonly data: Readonly<Record<string, unknown>> },
  fileRefId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<void> {
  const id = documentIdForFile(user.tenantId, fileRefId);
  // The title never defaults to the file name, which can carry personal data.
  const title = (rule.title?.(saved.data) ?? rule.category).slice(0, MAX_TITLE_LENGTH);
  const created = await executors.document.create(
    { id, title, category: rule.category, file: fileRefId },
    user,
    db,
  );
  // version_conflict: the stream exists already, so the file was captured before (and a document
  // deleted since stays deleted).
  if (!created.isSuccess && created.error.code !== "version_conflict") {
    throw new Error(
      `documents capture failed for ${rule.entity}.${rule.field}: ${created.error.code}`,
    );
  }
  // The gate hides rows from a caller without the registry; existence is the system user's question.
  const live = await executors.document.detail({ id }, createSystemUser(user.tenantId), db);
  // skip: the document was deleted after an earlier capture and stays deleted
  if (live === null) return;

  const targets: LinkTarget[] = [
    { entityType: rule.entity, entityId: saved.id },
    ...(rule.links?.(saved.data) ?? []),
  ].filter((target) => linkTargets.includes(target.entityType));
  for (const target of targets) {
    const linked = await ensureDocumentLink(executors, user, db, id, target);
    if (!linked.isSuccess) {
      throw new Error(
        `documents capture failed to link ${target.entityType}: ${linked.error.code}`,
      );
    }
  }
}

export function registerCapture(
  r: FeatureRegistrar<typeof DOCUMENTS_FEATURE_NAME>,
  executors: DocumentExecutors,
  rules: readonly DocumentCaptureRule[],
  linkTargets: readonly string[],
): void {
  for (const rule of rules) {
    r.hook({
      type: "postSave",
      target: { allOf: rule.entity },
      handler: async (result, ctx) => {
        const value =
          result.changes[rule.field] ?? (result.isNew ? result.data[rule.field] : undefined);
        // skip: the file field was not part of this save
        if (typeof value !== "string") return;
        await captureFile(
          executors,
          rule,
          linkTargets,
          { id: String(result.id), data: result.data },
          value,
          ctx.user,
          ctx.db,
        );
      },
    });
  }
}

export function validateCaptureRules(
  { features }: BootCheckContext,
  rules: readonly DocumentCaptureRule[],
  categories: readonly string[],
  linkTargets: readonly string[],
): void {
  for (const rule of rules) {
    const label = `documents capture ${rule.entity}.${rule.field}`;
    if (!categories.includes(rule.category)) {
      throw new Error(`${label}: category "${rule.category}" is not in the configured categories.`);
    }
    const entity = features.map((f) => f.entities?.[rule.entity]).find((e) => e !== undefined);
    if (entity === undefined)
      throw new Error(`${label}: entity "${rule.entity}" is not registered.`);
    const field = entity.fields[rule.field];
    if (field?.type !== "file" && field?.type !== "image") {
      throw new Error(`${label}: the field must be a single file or image field.`);
    }
  }
  const unknownTarget = linkTargets.find(
    (name) => !features.some((f) => f.entities?.[name] !== undefined),
  );
  if (unknownTarget !== undefined) {
    throw new Error(`documents linkTargets: entity "${unknownTarget}" is not registered.`);
  }
}
