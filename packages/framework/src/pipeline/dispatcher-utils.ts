import { parseQn, qn } from "../engine/qualified-name";
import type {
  HandlerRef,
  LifecycleResult,
  Registry,
  SessionUser,
  WriteResult,
} from "../engine/types";
import { type FieldIssue, toKumikoError, type WriteErrorInfo } from "../errors";

export type FailedWriteResult = Extract<WriteResult, { isSuccess: false }>;

export function isFailedWriteResult(result: unknown): result is FailedWriteResult {
  return (
    !!result && typeof result === "object" && "isSuccess" in result && result.isSuccess === false
  );
}

export function isLifecycleResult(data: unknown): data is LifecycleResult {
  return !!data && typeof data === "object" && "kind" in data;
}

export function isWriteResultShape(result: unknown): boolean {
  return (
    !!result &&
    typeof result === "object" &&
    "isSuccess" in result &&
    typeof result.isSuccess === "boolean"
  );
}

export function describeShape(result: unknown): string {
  if (result === null) return "null";
  if (result === undefined) return "undefined";
  if (typeof result !== "object") return typeof result;
  return `object with keys [${Object.keys(result).slice(0, 6).join(", ")}]`;
}

export function dispatcherSpanAttributes(
  type: string,
  operation: "query" | "write" | "stream",
  user: SessionUser,
  feature: string | undefined,
) {
  const attrs: Record<string, string | number | boolean> = {
    "kumiko.handler": type,
    "kumiko.operation": operation,
    "kumiko.user_id": user.id,
    "kumiko.tenant_id": user.tenantId,
  };
  if (feature) attrs["kumiko.feature"] = feature;
  return attrs;
}

export type AfterCommitHook = () => Promise<void>;

export type NestedSpec = {
  readonly key: string;
  readonly subType: string;
  readonly foreignKey: string;
  readonly items: readonly unknown[];
};

export type NestedTypeIssue = {
  readonly path: string;
  readonly code: string;
  readonly i18nKey: string;
};

export function extractNestedSpecs(
  parentType: string,
  payload: unknown,
  registry: Registry,
): {
  cleanPayload: Record<string, unknown>;
  specs: readonly NestedSpec[];
  typeIssues: readonly NestedTypeIssue[];
} | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  let parsed: ReturnType<typeof parseQn>;
  try {
    parsed = parseQn(parentType);
  } catch {
    return null;
  }
  // v1 scope: only create. Update/delete-nested are explicit future work —
  // they'd need different sub-types and id-handling semantics.
  if (!parsed.name.endsWith(":create")) return null;

  const entityName = registry.getHandlerEntity(parentType);
  if (!entityName) return null;

  const relations = registry.getRelations(entityName);
  const source = payload as Record<string, unknown>; // @cast-boundary engine-payload — generic dispatch über alle Entity-Types
  const clean: Record<string, unknown> = { ...source };
  const specs: NestedSpec[] = [];
  const typeIssues: NestedTypeIssue[] = [];

  for (const [relKey, rel] of Object.entries(relations)) {
    if (rel.type !== "hasMany" || !rel.nestedWrite) continue;
    if (!(relKey in source)) continue;
    const value = source[relKey];

    // Non-array under a nested-write key is a client shape error. Silent
    // strip (via default zod stripping) would hide it — a client sending
    // `tasks: "bogus"` or `tasks: null` has to know the field was ignored,
    // or they'll wonder why their data never showed up. Fail loud.
    if (!Array.isArray(value)) {
      typeIssues.push({
        path: relKey,
        code: "invalid_type",
        i18nKey: "errors.validation.invalid_type",
      });
      // Still strip from clean payload — we're not letting the parent handler
      // see a malformed value either.
      delete clean[relKey];
      continue;
    }

    // Strip the relation key from the clean payload — the parent handler
    // only sees columns it actually owns.
    delete clean[relKey];

    // Sub-type composition: derive scope + operation from the parent qn,
    // swap the entity segment. "feat:write:project:create" → "feat:write:task:create".
    // Assumes target entity has a `:create` handler in the SAME feature scope
    // as the parent. Cross-feature nested-writes are out of scope for v1;
    // when needed, the registry would have to carry a back-pointer from
    // entity → defining feature.
    const subType = qn(parsed.scope, parsed.type, `${rel.target}:create`);

    specs.push({
      key: relKey,
      subType,
      foreignKey: rel.foreignKey,
      items: value,
    });
  }

  if (specs.length === 0 && typeIssues.length === 0) return null;
  return { cleanPayload: clean, specs, typeIssues };
}

export function prefixValidationPath(info: WriteErrorInfo, prefix: string): WriteErrorInfo {
  if (info.code !== "validation_error") return info;
  const details = info.details as // @cast-boundary error-details
    | {
        fields?: readonly FieldIssue[];
      }
    | undefined;
  const fields = details?.fields;
  if (!fields) return info;
  return {
    ...info,
    details: {
      ...details,
      fields: fields.map((f) => ({ ...f, path: `${prefix}.${f.path}` })),
    },
  };
}

export class BatchRollback extends Error {
  constructor(
    readonly failedIndex: number,
    readonly failureError: WriteErrorInfo,
  ) {
    super(`batch rollback at command ${failedIndex}: ${failureError.code}`);
    this.name = "BatchRollback";
  }
}

export type HandlerType = string | HandlerRef;

export function resolveType(type: HandlerType): string {
  return typeof type === "string" ? type : type.name;
}

export const wrapToKumiko = toKumikoError;
