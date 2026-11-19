// kumiko-feature-version: 1
//
// Renderer selection is MIME-type-deterministic, not per-tenant, so no r.config and no r.extensionSelector.

import { cachedResponse } from "@cosmicdrift/kumiko-framework/api";
import {
  bootRuleError,
  defineFeature,
  EXT_DERIVATIVE_OVERLAY_RESOLVER,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  EXT_DERIVATIVE_RENDERER,
  type FeatureDefinition,
  isUuid,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import { FILE_DERIVATIVES_BOOT_RULES } from "./boot-rules.ts";
import {
  MAX_IF_NONE_MATCH_LENGTH,
  PUBLIC_VARIANT_QN,
  type PublicVariantResult,
  publicVariantQuery,
} from "./handlers/public-variant.query.ts";
import {
  PUBLIC_VARIANT_BY_FILE_REF_QN,
  publicVariantByFileRefQuery,
} from "./handlers/public-variant-by-file-ref.query.ts";

const FEATURE_NAME = "file-derivatives";

// Syntactic only: a name allow-list would defend nothing, since a valid name plus a random UUID
// reaches the same DB read. This only keeps pathological input (separators, `..`, oversized) out
// before that round-trip; `variants` keys have no charset constraint, so stay permissive.
// Do not reintroduce a name list here "for safety".
const VARIANT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Host → tenantId for the anonymous media route.
 *  MUST be cheap/synchronous (in-memory map or cached lookup): it runs
 *  *before* the query-handler rate limit, so a DB round-trip here is an
 *  unthrottled DoS surface for anonymous callers rotating Host headers. */
export type PublicVariantResolveApexTenant = (
  host: string,
) => Promise<TenantId | null> | TenantId | null;

export type PublicVariantTenantResolution = "host" | "fileRef";

export type FileDerivativesOptions = {
  /** Host → tenantId for the anonymous `/media/:fileRefId/:variant` route.
   *  Without this option, neither the httpRoute NOR the `publicVariant`
   *  query is registered — it is unreachable via the httpRoute path and via
   *  the generic `/api` query dispatch. Existing consumers that only need
   *  `ctx.services.derivatives` are unaffected. See {@link PublicVariantResolveApexTenant}
   *  for the in-memory/sync contract. */
  readonly resolveApexTenant?: PublicVariantResolveApexTenant;
  /** Base path of the public variant route. Default "/media". */
  readonly basePath?: string;
  /** How the route picks the tenant a variant is read from. "host" (default):
   *  tenant = resolveApexTenant(host). "fileRef": resolveApexTenant still
   *  gates the host (an unknown host still 404s), but the variant itself is
   *  read from the FileRef row's own tenant — a single shared platform host
   *  then serves every tenant's public variants. The FileRef-tenant's own
   *  `isPublic` predicate remains the default-deny gate either way; requires
   *  `resolveApexTenant`. */
  readonly publicTenantResolution?: PublicVariantTenantResolution;
};

// Raw handler-return of publicVariantQuery — systemQuery dispatches
// directly against the handler, no `{data}` wire envelope.
type PublicVariantQueryResult = PublicVariantResult | null;

// tenantId never comes from the payload: from the Host via resolveApexTenant, or from the FileRef row in fileRef mode.
export function createFileDerivativesFeature(opts: FileDerivativesOptions = {}): FeatureDefinition {
  const basePath = opts.basePath ?? "/media";
  if (opts.publicTenantResolution !== undefined && !opts.resolveApexTenant) {
    throw bootRuleError(FILE_DERIVATIVES_BOOT_RULES.publicTenantResolutionWithoutApexResolver, {
      message:
        "createFileDerivativesFeature: publicTenantResolution requires resolveApexTenant — it only changes which tenant a variant is read from, resolveApexTenant still gates the host.",
    });
  }

  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        "Declares the `derivativeRenderer` extension point. `ctx.services.derivatives.variant(fileRefId, spec, name)` derives a variant of a tracked FileRef the first time it's requested and reuses the stored result afterwards (derive-on-first-use, keyed by a hash of the spec). Mount at least one `derivatives-*` renderer feature alongside this one — without a registered renderer for the FileRef's MIME type, every `variant(...)` call throws. Also declares the `derivativePublicPredicate` extension point (`r.applyExtension({ name: EXT_DERIVATIVE_PUBLIC_PREDICATE, entity: '<entityType>', isPublic })`) and, when `createFileDerivativesFeature({resolveApexTenant})` is passed a host-resolver, mounts an anonymous `GET {basePath}/:fileRefId/:variant` route that serves any variant name the FileRef's field declared in its `variants` for a FileRef whose entityType has a registered predicate returning true — default-deny (404) otherwise, same as an unknown FileRef or an undeclared variant name. The route's only rate-limit (`per: \"ip\"`) depends on the server's `trustedProxyHops` matching the deployment's actual reverse-proxy count — at the default 0 it ignores `x-forwarded-for` entirely, so every caller shares one bucket until that's configured. `publicTenantResolution: \"fileRef\"` keeps resolveApexTenant as the host gate but reads the variant from the FileRef row's own tenant instead of the host's, so one shared platform host serves every tenant's public variants — each FileRef-tenant's own `isPublic` predicate still default-denies. Also declares the `derivativeOverlayResolver` extension point (`r.applyExtension({ name: EXT_DERIVATIVE_OVERLAY_RESOLVER, entity: '<entityType>', resolve })`), used to turn a variant's `overlays[].dataToken` into the actual QR payload for that FileRef's entityType before the variant is rendered — a variant declaring a `qr` overlay throws at request-time if no resolver is registered for the FileRef's entityType.",
      );
      r.uiHints({
        displayLabel: "File Derivatives",
        category: "storage",
        recommended: false,
      });
      // Needs a storage provider to read the original and write the variant.
      r.requires({ features: ["file-foundation"] });
      // variant() reads fileRefsTable, which "files" owns; without it the first variant() fails with a SQL error.
      r.requires({ features: ["files"] });

      r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, {});
      r.extendsRegistrar(EXT_DERIVATIVE_PUBLIC_PREDICATE, {});
      r.extendsRegistrar(EXT_DERIVATIVE_OVERLAY_RESOLVER, {});

      // Registered only with resolveApexTenant: r.queryHandler exposes `publicVariant` (anonymous)
      // on `/api` as a side effect, which would bypass "tenantId comes from the host".
      if (opts.resolveApexTenant) {
        const resolveApexTenant = opts.resolveApexTenant;
        const byFileRef = opts.publicTenantResolution === "fileRef";
        const routeQn = byFileRef ? PUBLIC_VARIANT_BY_FILE_REF_QN : PUBLIC_VARIANT_QN;

        r.queryHandler(publicVariantQuery);
        // Registered only in "fileRef" mode: it does an unsafeRaw cross-tenant FileRef lookup that
        // must not be reachable via the generic `/api` dispatch in "host" mode.
        if (byFileRef) {
          // Request-time tenant check needs the tenant feature; require it so a missing mount fails boot.
          r.requires({ features: ["tenant"] });
          r.queryHandler(publicVariantByFileRefQuery);
        }

        r.httpRoute({
          method: "GET",
          path: `${basePath}/:fileRefId/:variant`,
          anonymous: true,
          handler: async (c, { systemQuery }) => {
            // `param(...)` is string|undefined: the computed path template defeats Hono's inference.
            const fileRefId = c.req.param("fileRefId");
            const variant = c.req.param("variant");
            // 404, not 400, so a bad name and a missing file answer identically (no name oracle);
            // a malformed id must fail here, since the UUID column would throw 22P02 per anonymous
            // request (DoS on the pooled connection).
            if (!fileRefId || !variant || !VARIANT_NAME_RE.test(variant) || !isUuid(fileRefId)) {
              return c.text("not found", 404);
            }

            const host = c.req.header("host") ?? new URL(c.req.url).host;
            const tenantId = await resolveApexTenant(host);
            if (!tenantId) return c.text("not found", 404);

            const ifNoneMatch = c.req.header("if-none-match");
            let result: PublicVariantQueryResult;
            try {
              // @cast-boundary engine-payload — shape comes from
              // publicVariantQuery's return type (publicVariantByFileRefQuery
              // returns exactly that, or null, never its own shape).
              result = (await systemQuery(
                routeQn,
                {
                  fileRefId,
                  variant,
                  ...(ifNoneMatch !== undefined &&
                    ifNoneMatch.length <= MAX_IF_NONE_MATCH_LENGTH && { ifNoneMatch }),
                },
                tenantId,
              )) as PublicVariantQueryResult;
            } catch (err) {
              if (err instanceof RateLimitError) {
                return c.text("rate limited", 429);
              }
              // biome-ignore lint/suspicious/noConsole: ops-visible fallback, no logger wired into HttpRouteHandlerDeps
              console.error(
                `file-derivatives: public-variant query failed for fileRefId="${fileRefId}" variant="${variant}"`,
                err,
              );
              return c.text("variant unavailable", 503);
            }
            if (!result) return c.text("not found", 404);

            return cachedResponse(c.req.raw, {
              // notModified means the query already matched this If-None-Match against the same
              // revision; cachedResponse repeats that check and answers 304, so the null body is
              // never sent as a 200.
              body: result.notModified ? null : Buffer.from(result.dataBase64, "base64"),
              etag: result.revision,
              cache: { kind: "revalidate", maxAgeSeconds: 60 },
              // Explicit here, not left to the app-wide security-headers default, so the route stays safe standalone.
              headers: {
                "content-type": result.mimeType,
                vary: "Host",
                "x-content-type-options": "nosniff",
              },
            });
          },
        });
      }
    },
    Object.keys(opts).length === 0 ? { dedupeOptions: {} } : undefined,
  );
}
