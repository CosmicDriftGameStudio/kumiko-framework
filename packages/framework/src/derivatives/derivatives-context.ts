import type {
  DerivativeRendererPlugin,
  DerivativesContext,
  OverlayLayer,
  ResolvedOverlayLayer,
  VariantSpec,
} from "@cosmicdrift/kumiko-types/derivatives-types";
import { type AnyDb, fetchOne } from "../bun-db/query";
import {
  EXT_DERIVATIVE_OVERLAY_RESOLVER,
  EXT_DERIVATIVE_RENDERER,
} from "../engine/extension-names";
import type { Registry, TenantId } from "../engine/types";
import { InternalError, NotFoundError } from "../errors";
import type { FileContext } from "../files/file-handle";
import { fileRefsTable } from "../files/file-ref-table";
import { assertSafeStorageKey } from "../files/types";
import { variantSuffix } from "./variant-key";

export type DerivativesContextDeps = {
  readonly files: FileContext;
  readonly registry: Registry;
  readonly db: AnyDb;
  readonly tenantId: TenantId;
};

// extension-usage `options` is engine-payload (unknown) — structurally validate
// instead of casting blind, same pattern as isFileProviderPlugin.
function isDerivativeRendererPlugin(o: unknown): o is DerivativeRendererPlugin {
  return typeof o === "object" && o !== null && "render" in o && typeof o.render === "function";
}

// Mirrors validateFile's mime-normalization: strip a `; charset=…` suffix,
// trim, lowercase — so a provider-supplied `image/jpeg; charset=binary`
// still resolves.
function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

export function resolveRenderer(
  registry: Registry,
  mimeType: string,
): DerivativeRendererPlugin | undefined {
  const normalized = normalizeMimeType(mimeType);
  const usages = registry.getExtensionUsages(EXT_DERIVATIVE_RENDERER);

  const exact = usages.find((u) => u.entityName === normalized);
  if (exact) {
    if (!isDerivativeRendererPlugin(exact.options))
      throw new Error(
        `derivatives.resolveRenderer: "${exact.entityName}" registered without a render(input, spec, sourceMimeType) — extension options must be a DerivativeRendererPlugin.`,
      );
    return exact.options;
  }

  const wildcard = usages.find((u) => u.entityName === `${normalized.split("/")[0]}/*`);
  if (wildcard) {
    if (!isDerivativeRendererPlugin(wildcard.options))
      throw new Error(
        `derivatives.resolveRenderer: "${wildcard.entityName}" registered without a render(input, spec, sourceMimeType) — extension options must be a DerivativeRendererPlugin.`,
      );
    return wildcard.options;
  }

  return undefined;
}

export type OverlayResolverArgs = {
  readonly entityId: string;
  readonly tenantId: TenantId;
  readonly fieldName: string;
  readonly dataToken: string;
};

export type OverlayResolverPlugin = {
  readonly resolve: (args: OverlayResolverArgs) => string | Promise<string>;
};

// extension-usage `options` is engine-payload (unknown) — structurally validate
// instead of casting blind, same pattern as isDerivativeRendererPlugin.
function isOverlayResolverPlugin(o: unknown): o is OverlayResolverPlugin {
  return typeof o === "object" && o !== null && "resolve" in o && typeof o.resolve === "function";
}

type FileRefRow = {
  readonly storageKey: string;
  readonly mimeType: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly fieldName: string | null;
};

function isFileRefRow(row: Record<string, unknown>): row is FileRefRow {
  return (
    typeof row["storageKey"] === "string" &&
    typeof row["mimeType"] === "string" &&
    (row["entityType"] === null || typeof row["entityType"] === "string") &&
    (row["entityId"] === null || typeof row["entityId"] === "string") &&
    (row["fieldName"] === null || typeof row["fieldName"] === "string")
  );
}

// A qr overlay needs the FileRef's field identity to pick a resolver and to
// hand the resolver something to look up — narrows the 3 nullable columns
// together so the throw below can name whichever one is actually missing.
type FieldIdentifiedFileRef = FileRefRow & {
  readonly entityType: string;
  readonly entityId: string;
  readonly fieldName: string;
};

function hasFieldIdentity(row: FileRefRow): row is FieldIdentifiedFileRef {
  return row.entityType !== null && row.entityId !== null && row.fieldName !== null;
}

type QrOverlayContext = {
  readonly row: FieldIdentifiedFileRef;
  readonly plugin: OverlayResolverPlugin;
};

// Looks up the entityType's resolver once per variant() call (not once per
// qr layer) and fails before any layer is touched — a spec with 3 qr layers
// and no registration throws once, not on the first layer only.
function resolveQrOverlayContext(row: FileRefRow, registry: Registry): QrOverlayContext {
  if (!hasFieldIdentity(row)) {
    throw new InternalError({
      message:
        "derivatives.variant: a qr overlay requires the FileRef's entityType/entityId/fieldName, but at least one is missing.",
      details: { entityType: row.entityType, entityId: row.entityId, fieldName: row.fieldName },
    });
  }
  const usage = registry
    .getExtensionUsages(EXT_DERIVATIVE_OVERLAY_RESOLVER)
    .find((u) => u.entityName === row.entityType);
  if (!usage) {
    throw new InternalError({
      message: `derivatives.variant: no ${EXT_DERIVATIVE_OVERLAY_RESOLVER} registered for entityType "${row.entityType}".`,
      details: { entityType: row.entityType },
    });
  }
  if (!isOverlayResolverPlugin(usage.options)) {
    throw new Error(
      `derivatives.variant: "${usage.entityName}" registered ${EXT_DERIVATIVE_OVERLAY_RESOLVER} without a resolve(args) — extension options must be an OverlayResolverPlugin.`,
    );
  }
  return { row, plugin: usage.options };
}

async function resolveQrLayer(
  layer: Extract<OverlayLayer, { kind: "qr" }>,
  context: QrOverlayContext,
  tenantId: TenantId,
): Promise<ResolvedOverlayLayer> {
  const { dataToken, ...placement } = layer;
  const data = await context.plugin.resolve({
    entityId: context.row.entityId,
    tenantId,
    fieldName: context.row.fieldName,
    dataToken,
  });
  if (!data) {
    throw new InternalError({
      message: `derivatives.variant: ${EXT_DERIVATIVE_OVERLAY_RESOLVER} resolved dataToken "${dataToken}" to an empty value for entityType "${context.row.entityType}".`,
      details: { entityType: context.row.entityType, dataToken },
    });
  }
  return { ...placement, data };
}

// A non-qr layer is already ResolvedOverlayLayer-shaped (see
// ResolvedOverlayLayer's `image` member) — this only exists because TS can't
// derive that from `layer.kind !== "qr"` across a Promise.all/map boundary.
function resolveOverlayLayer(
  layer: OverlayLayer,
  qrContext: QrOverlayContext | undefined,
  tenantId: TenantId,
): Promise<ResolvedOverlayLayer> | ResolvedOverlayLayer {
  if (layer.kind !== "qr") return layer;
  if (!qrContext) {
    throw new Error(
      "derivatives.variant: unreachable — resolveOverlaySpec only omits a qr context when the spec has no qr layer.",
    );
  }
  return resolveQrLayer(layer, qrContext, tenantId);
}

// Resolves every `qr` layer's dataToken to a concrete value and moves the
// whole overlay list to `resolvedOverlays` — BEFORE variantSuffix() hashes
// the spec, so a resolver whose target changes (e.g. a base-URL rotation)
// invalidates the cache instead of serving a stale target under the old key.
async function resolveOverlaySpec(
  spec: VariantSpec,
  row: FileRefRow,
  registry: Registry,
  tenantId: TenantId,
): Promise<VariantSpec> {
  if (!spec.overlays || spec.overlays.length === 0) return spec;

  const qrContext = spec.overlays.some((layer) => layer.kind === "qr")
    ? resolveQrOverlayContext(row, registry)
    : undefined;

  const resolvedOverlays = await Promise.all(
    spec.overlays.map((layer) => resolveOverlayLayer(layer, qrContext, tenantId)),
  );
  return { ...spec, overlays: undefined, resolvedOverlays };
}

// sourceMimeType is client-controlled (it's `file.type` off the upload — see
// file-routes.ts's "a field without `accept` lets a client upload anything")
// and, when spec.format is unset, a renderer is documented to preserve the
// source's own format (DerivativeRendererPlugin's doc comment) — so the
// bytes really are in this format, but the STRING itself must still be
// allowlisted before it becomes a response Content-Type or storage-provider
// metadata. Otherwise an app whose renderer wildcard is broad enough (e.g.
// `image/*`) would let a client-declared `image/svg+xml` ride straight
// through as an honestly-declared (non-sniffed) active-content type (#2021).
const KNOWN_SAFE_VARIANT_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

// The spec — not the renderer — determines the output mimeType, so it's the
// single source of truth for both what gets written to storage and what the
// caller receives; a cache hit never runs the renderer, so there's nothing
// else to derive it from.
function outputMimeType(spec: VariantSpec, sourceMimeType: string): string {
  switch (spec.format) {
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "jpeg":
      return "image/jpeg";
    default: {
      const normalized = normalizeMimeType(sourceMimeType);
      return KNOWN_SAFE_VARIANT_MIME_TYPES.has(normalized)
        ? normalized
        : "application/octet-stream";
    }
  }
}

// `deps.db` is whatever the caller passes through — in the write-handler
// pipeline (dispatch-shared.ts) that's the handler's open DbTx. `variant()`
// then holds that transaction open across a full render (decode/resize/
// encode) plus the storage read+write, not just the fetchOne/exists checks.
// On a later rollback in the same handler, a variant already written to
// storage is orphaned there (row never committed, bytes never cleaned up).
// Prefer this context from the job/MSP path, where `deps.db` isn't tied to
// an in-flight write transaction; a synchronous write handler rendering a
// large image should hand off to a job instead of calling `variant()` inline.
export function createDerivativesContext(deps: DerivativesContextDeps): DerivativesContext {
  return {
    variant: async (fileRefId, spec, name) => {
      const row = await fetchOne<Record<string, unknown>>(deps.db, fileRefsTable, {
        id: fileRefId,
        tenantId: deps.tenantId,
        isDeleted: false,
      });
      if (!row) {
        throw new NotFoundError("fileRef", fileRefId);
      }
      if (!isFileRefRow(row)) {
        throw new NotFoundError("fileRef", fileRefId);
      }

      const renderer = resolveRenderer(deps.registry, row.mimeType);
      if (!renderer) {
        const known =
          deps.registry
            .getExtensionUsages(EXT_DERIVATIVE_RENDERER)
            .map((u) => u.entityName)
            .join(", ") || "<none>";
        throw new InternalError({
          message: `derivatives.variant: no renderer registered for mimeType "${row.mimeType}".`,
          details: { knownRenderers: known },
        });
      }

      // Resolves qr dataTokens to concrete values BEFORE the spec is hashed
      // — see resolveOverlaySpec.
      const resolvedSpec = await resolveOverlaySpec(spec, row, deps.registry, deps.tenantId);

      const src = deps.files.ref(row.storageKey);
      // ponytail: derived key keeps the source extension regardless of the
      // spec's format — widen deriveKey if a storage backend ever routes on
      // extension.
      const target = src.derive(variantSuffix(name, resolvedSpec));
      // Belt-and-suspenders: variantSuffix already rejects an unsafe name,
      // this catches a traversal segment reaching the key through any other
      // path (e.g. a future deriveKey change).
      assertSafeStorageKey(target.key);
      const mimeType = outputMimeType(resolvedSpec, row.mimeType);

      // ponytail: exists→render→write is a TOCTOU window under concurrent
      // requests for the same variant (duplicate render + write). Ceiling:
      // non-atomic providers can briefly expose a half-written object as a
      // cache hit. Upgrade: write to a temp key then atomic rename/copy.
      if (await target.exists()) {
        return {
          storageKey: target.key,
          mimeType,
          rendered: false,
        };
      }

      const original = await src.read();
      const result = await renderer.render(original, resolvedSpec, row.mimeType);
      await target.write(result, mimeType);
      return {
        storageKey: target.key,
        mimeType,
        rendered: true,
      };
    },
  };
}
