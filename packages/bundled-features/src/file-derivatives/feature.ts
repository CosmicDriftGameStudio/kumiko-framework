// kumiko-feature-version: 1
//
// Same extension-point/provider-feature pattern as file-foundation — see
// r.describe below for what this feature does. Unlike `fileProvider`,
// renderer selection is MIME-type-deterministic, not per-tenant
// configurable, so this feature has no `r.config` and no
// `r.extensionSelector`.

import { cachedResponse, computeRevisionEtag } from "@cosmicdrift/kumiko-framework/api";
import {
  defineFeature,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
  EXT_DERIVATIVE_RENDERER,
  type FeatureDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import { PUBLIC_VARIANT_QN, publicVariantQuery } from "./handlers/public-variant.query";

const FEATURE_NAME = "file-derivatives";

// fileRefsTable.id is a UUID column — a malformed id must fail here, not at
// the DB. Without this, an anonymous, internet-facing caller can throw a
// Postgres 22P02 on every request (Bun.SQL pools the failed connection),
// a DoS primitive with no auth required.
const FILE_REF_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Syntactic only, no registry/name-list lookup: a valid preset name plus a
// random UUID reaches the same DB read anyway, so an allow-list of known
// names defends nothing a determined caller can't route around — it only
// blocks the cheaper of two equally-costly attacks. What a name actually
// resolves to is decided by the field declaration in publicVariantQuery;
// this just keeps pathological input (path separators, `..`, oversized
// strings) out before that DB round-trip. `variants` keys have no runtime
// charset constraint (`Readonly<Record<string, VariantSpec>>`), so this
// stays permissive rather than guessing a convention — narrower than this
// would silently 404 a legitimately declared name again. Do not reintroduce
// a name list here "for safety" — see #1985.
const VARIANT_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export type PublicVariantResolveApexTenant = (
  host: string,
) => Promise<TenantId | null> | TenantId | null;

export type FileDerivativesOptions = {
  /** Host → tenantId for the anonymous `/media/:fileRefId/:variant` route.
   *  Without this option, neither the httpRoute NOR the `publicVariant`
   *  query is registered — it is unreachable via the httpRoute path and via
   *  the generic `/api` query dispatch. Existing consumers that only need
   *  `ctx.derivatives` are unaffected. */
  readonly resolveApexTenant?: PublicVariantResolveApexTenant;
  /** Base path of the public variant route. Default "/media". */
  readonly basePath?: string;
};

// Raw handler-return of publicVariantQuery — systemQuery dispatches
// directly against the handler, no `{data}` wire envelope.
type PublicVariantQueryResult = {
  readonly dataBase64: string;
  readonly mimeType: string;
  readonly storageKey: string;
} | null;

// file-derivatives — derive-on-first-use file variants (thumbnails,
// resized/reformatted images) plus an opt-in ANONYMOUS route that serves any
// variant an app declared on the FileRef's field (`createImageField({
// variants: {...} })`, including but not limited to the `thumb`/`card`/
// `hero`/`full` presets exported from `./presets`), for a FileRef whose
// entityType has a registered, default-deny `derivativePublicPredicate`.
//
// The route never serves the original and never accepts a free VariantSpec
// — only a name, resolved against the field's own `variants` declaration —
// and only after the app's registered `isPublic` predicate for the FileRef's
// entityType says yes. tenantId is resolved from the request Host via
// `resolveApexTenant`, NEVER read from the request payload.
export function createFileDerivativesFeature(opts: FileDerivativesOptions = {}): FeatureDefinition {
  const basePath = opts.basePath ?? "/media";

  return defineFeature(FEATURE_NAME, (r) => {
    r.describe(
      "Declares the `derivativeRenderer` extension point. `ctx.derivatives.variant(fileRefId, spec, name)` derives a variant of a tracked FileRef the first time it's requested and reuses the stored result afterwards (derive-on-first-use, keyed by a hash of the spec). Mount at least one `derivatives-*` renderer feature alongside this one — without a registered renderer for the FileRef's MIME type, every `variant(...)` call throws. Also declares the `derivativePublicPredicate` extension point (`r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, '<entityType>', { isPublic })`) and, when `createFileDerivativesFeature({resolveApexTenant})` is passed a host-resolver, mounts an anonymous `GET {basePath}/:fileRefId/:variant` route that serves any variant name the FileRef's field declared in its `variants` for a FileRef whose entityType has a registered predicate returning true — default-deny (404) otherwise, same as an unknown FileRef or an undeclared variant name. The route's only rate-limit (`per: \"ip\"`) trusts the first `x-forwarded-for` hop — deployers must ensure their ingress overwrites rather than appends to that header, or the throttle is bypassable by rotating it.",
    );
    r.uiHints({
      displayLabel: "File Derivatives",
      category: "storage",
      recommended: false,
    });
    // Needs a storage provider to read the original + write the variant —
    // without file-foundation there's nothing to derive from or write to.
    r.requires("file-foundation");

    r.extendsRegistrar(EXT_DERIVATIVE_RENDERER, {
      onRegister: () => {
        // No side-effects at register-time — resolution (exact MIME match,
        // then `<type>/*` wildcard) happens at request-time in
        // resolveRenderer, mirrors file-foundation's fileProvider point.
      },
    });
    r.extendsRegistrar(EXT_DERIVATIVE_PUBLIC_PREDICATE, {
      onRegister: () => {
        // No side-effects at register-time — resolution happens at
        // request-time in publicVariantQuery, keyed by the FileRef's
        // entityType.
      },
    });

    // Registered ONLY when resolveApexTenant is supplied — r.queryHandler
    // registers publicVariantQuery into the feature's dispatch table as a
    // side effect of being called, independent of what's done with its
    // return value. Calling it unconditionally would make `publicVariant`
    // (access: ["anonymous", ...]) reachable via the generic `/api` query
    // dispatch even when the httpRoute below isn't mounted, bypassing the
    // "tenantId comes from the host, never the payload" invariant that only
    // `resolveApexTenant` enforces.
    const queries: { publicVariant?: ReturnType<typeof r.queryHandler> } = {};

    if (opts.resolveApexTenant) {
      const resolveApexTenant = opts.resolveApexTenant;

      queries.publicVariant = r.queryHandler(publicVariantQuery);

      r.httpRoute({
        method: "GET",
        path: `${basePath}/:fileRefId/:variant`,
        anonymous: true,
        handler: async (c, { systemQuery }) => {
          // `param(...)` is string|undefined here — `path` is a computed
          // template, so Hono can't infer the param type from a literal.
          const fileRefId = c.req.param("fileRefId");
          const variant = c.req.param("variant");
          // 404, not 400 — a syntactically bad name and "doesn't exist" must
          // answer identically, no name-oracle.
          if (
            !fileRefId ||
            !variant ||
            !VARIANT_NAME_RE.test(variant) ||
            !FILE_REF_ID_RE.test(fileRefId)
          ) {
            return c.text("not found", 404);
          }

          const host = c.req.header("host") ?? new URL(c.req.url).host;
          const tenantId = await resolveApexTenant(host);
          if (!tenantId) return c.text("not found", 404);

          let result: PublicVariantQueryResult;
          try {
            // @cast-boundary engine-payload — shape comes from
            // publicVariantQuery's return type.
            result = (await systemQuery(
              PUBLIC_VARIANT_QN,
              { fileRefId, variant },
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

          const bytes = Buffer.from(result.dataBase64, "base64");
          const etag = computeRevisionEtag([tenantId, fileRefId, variant, result.storageKey]);
          return cachedResponse(c.req.raw, {
            body: bytes,
            etag,
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

    return { queries };
  });
}

export const fileDerivativesFeature = createFileDerivativesFeature();
