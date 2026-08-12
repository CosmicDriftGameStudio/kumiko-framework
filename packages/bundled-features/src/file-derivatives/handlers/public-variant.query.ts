// Public-Read of a derived FileRef variant (thumbnail/card/hero/full) — the
// anonymous counterpart to GET /files/:id/variant/:name (#1950, auth-gated,
// field-declared variants). This route never serves the original, never
// accepts a free VariantSpec, and only serves one of the 4 fixed presets.
// Default-deny: an entityType with no `EXT_DERIVATIVE_PUBLIC_PREDICATE`
// registration, or a predicate that returns false, both answer `null` —
// the httpRoute wrapper in feature.ts turns that into a 404, same as a
// FileRef that doesn't exist (no existence-leak via distinct status codes).
//
// tenantId comes from `query.user.tenantId` ONLY (host-resolved by the
// httpRoute wrapper's `resolveApexTenant`), never from the payload.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineQueryHandler,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  type HandlerContext,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import type { VariantSpec } from "@cosmicdrift/kumiko-types/derivatives-types";
import { z } from "zod";
import { card, full, hero, PRESET_VARIANT_NAMES, thumb } from "../presets";

// satisfies catches a preset added to PRESET_VARIANT_NAMES but not here (or
// vice versa) at compile time instead of a runtime `undefined` spec lookup.
const VARIANT_SPECS = { thumb, card, hero, full } as const satisfies Record<
  (typeof PRESET_VARIANT_NAMES)[number],
  VariantSpec
>;

type FileRefRow = {
  readonly entityType: string | null;
  readonly entityId: string | null;
};

export type DerivativePublicPredicateArgs = {
  readonly entityId: string;
  readonly tenantId: TenantId;
};

export type DerivativePublicPredicatePlugin = {
  readonly isPublic: (
    args: DerivativePublicPredicateArgs,
    ctx: HandlerContext,
  ) => boolean | Promise<boolean>;
};

// extension-usage `options` is engine-payload (unknown) — structurally
// validate instead of casting blind, same pattern as
// isDerivativeRendererPlugin in derivatives-context.ts.
function isDerivativePublicPredicatePlugin(o: unknown): o is DerivativePublicPredicatePlugin {
  return typeof o === "object" && o !== null && "isPublic" in o && typeof o.isPublic === "function";
}

// Full QN this handler is registered under once mounted into the
// "file-derivatives" feature (short name below + registry qualification —
// see qualifyEntityName). Kept as a separate literal, not derived, so
// feature.ts's systemQuery call doesn't need a code import of the handler
// def itself — mirrors managed-pages' BY_SLUG_QN.
export const PUBLIC_VARIANT_QN = "file-derivatives:query:public-variant";

export const publicVariantQuery = defineQueryHandler({
  name: "public-variant",
  schema: z.object({
    fileRefId: z.string(),
    variant: z.enum(PRESET_VARIANT_NAMES),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  // ponytail: "ip" trusts the first x-forwarded-for hop (buildRequestContextData
  // in request-id-middleware.ts) — this is the ONLY throttle on an anonymous,
  // internet-facing render/storage-cost route, so it assumes the deployment's
  // ingress overwrites (not appends to) x-forwarded-for. A direct-to-origin
  // deployment lets a caller rotate the header per request and bypass this.
  // Upgrade path if that assumption doesn't hold: trusted-proxy-count config
  // on buildRequestContextData, same fix point as every other /api/* route.
  rateLimit: { per: "ip", limit: 60, windowSeconds: 60 },
  handler: async (query, ctx) => {
    const row = await fetchOne<FileRefRow>(ctx.db, fileRefsTable, {
      id: query.payload.fileRefId,
      tenantId: ctx.user.tenantId,
      isDeleted: false,
    });
    if (!row) return null;
    const { entityType, entityId } = row;
    if (entityType === null || entityId === null) return null;

    const usage = ctx.registry
      .getExtensionUsages(EXT_DERIVATIVE_PUBLIC_PREDICATE)
      .find((u) => u.entityName === entityType);
    if (!usage) return null;
    if (!isDerivativePublicPredicatePlugin(usage.options)) {
      throw new Error(
        `file-derivatives: "${usage.entityName}" registered ${EXT_DERIVATIVE_PUBLIC_PREDICATE} without an isPublic(args, ctx) — extension options must be a DerivativePublicPredicatePlugin.`,
      );
    }

    const isPublic = await usage.options.isPublic({ entityId, tenantId: ctx.user.tenantId }, ctx);
    if (!isPublic) return null;

    // ctx.files/ctx.derivatives are optional on HandlerContext (only wired
    // when file-foundation resolved a provider) — narrow via a plain guard,
    // never `!`/`as`, and surface a real config error (not a silent deny)
    // when the feature isn't actually wired.
    const { files, derivatives } = ctx;
    if (!files || !derivatives) {
      throw new Error(
        "file-derivatives requires ctx.files/ctx.derivatives — is file-foundation mounted?",
      );
    }

    const spec = VARIANT_SPECS[query.payload.variant];
    const result = await derivatives.variant(query.payload.fileRefId, spec, query.payload.variant);
    const bytes = await files.ref(result.storageKey).read();

    // ponytail: fully buffered (no streaming), +33% over the wire from
    // base64 — HttpRouteHandlerDeps only exposes {app, systemQuery} (no
    // direct ctx.files access from the Hono handler itself), and the local
    // dev storage provider has no getSignedUrl (a redirect design wouldn't
    // work in dev). Upgrade path: a binary-passthrough dispatcher primitive
    // would be its own, larger issue.
    return {
      dataBase64: Buffer.from(bytes).toString("base64"),
      mimeType: result.mimeType,
      storageKey: result.storageKey,
    };
  },
});
