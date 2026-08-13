// Files Post-Processing Sample
//
// The three ways to get an image variant out of a FileRef — see
// docs/reference/core-files.md for the full write-up of the contract and
// security model behind each.
//
//   1. Declarative — `original`'s `variants` map on the `photo` entity. The
//      normal case (profile picture, hero image, floor plan): the framework
//      resolves + caches the variant behind the auth-gated
//      `GET /api/files/:id/variant/:name` route, no handler code needed.
//   2. Imperative — the `set-cover` write-handler calls
//      `ctx.derivatives.variant()` directly. This is for apps that track
//      images as their own records (ordering, a chosen cover image) and for
//      region-blur, whose coordinates are runtime data that can't live in a
//      static field declaration.
//   3. The public route with a predicate — the part people get wrong. Only
//      entityIds explicitly marked published resolve; everything else 404s,
//      indistinguishable from "doesn't exist".

import type { DerivativePublicPredicateArgs } from "@cosmicdrift/kumiko-bundled-features/file-derivatives";
import {
  createEntity,
  createImageField,
  defineFeature,
  EXT_DERIVATIVE_PUBLIC_PREDICATE,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

// The `variants` map IS the whitelist the auth-gated variant route resolves
// against — no separate registration step. Named `thumb`/`hero` on purpose:
// the public route's fixed presets (thumb/card/hero/full, entry point 3)
// share the name `thumb` but are a completely separate spec — same label,
// different whitelist, different actual pixels.
const photoEntity = createEntity({
  table: "files_post_processing_photos",
  fields: {
    original: createImageField({
      variants: {
        thumb: { maxEdge: 200, fit: "cover", format: "webp" },
        hero: { maxEdge: 1200, fit: "inside", format: "webp" },
      },
    }),
  },
});

// A real app would check a `published` column via the entity's read model.
// This recipe tracks it in memory to stay a single file — the predicate
// below is what matters, not where the flag is stored. Keyed by
// `${tenantId}:${entityId}`, not entityId alone — two tenants can each have
// their own entityId "p3", and an entityId-only key would leak tenant A's
// publish state onto tenant B's photo.
export const publishedPhotoIds = new Set<string>();

// Exported so the integration test can assert the imperative path ran.
export const coverOrder: string[] = [];

export const filesPostProcessingFeature = defineFeature("files-post-processing", (r) => {
  r.requires("file-derivatives");
  r.entity("photo", photoEntity);

  // Entry point 2 — imperative. A real app would gate this behind real
  // roles; `openToAll` keeps the recipe's HTTP wiring to one line.
  r.writeHandler(
    "set-cover",
    z.object({
      fileRefId: z.string(),
      // Relative to the ORIGINAL image's pixels, clamped before resize —
      // runtime data (e.g. a detected face box), which is exactly why this
      // can only be expressed imperatively, not in a static field def.
      blurRegion: z
        .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
        .optional(),
    }),
    async (event, ctx) => {
      if (!ctx.derivatives) {
        return writeFailure(
          new InternalError({ message: "ctx.derivatives missing — is file-derivatives mounted?" }),
        );
      }
      const { fileRefId, blurRegion } = event.payload;
      const result = await ctx.derivatives.variant(
        fileRefId,
        {
          maxEdge: 800,
          fit: "cover",
          format: "webp",
          ...(blurRegion ? { blurRegions: [blurRegion] } : {}),
        },
        "cover",
      );
      coverOrder.push(fileRefId);
      return { isSuccess: true as const, data: { fileRefId, storageKey: result.storageKey } };
    },
    { access: { openToAll: true } },
  );

  r.writeHandler(
    "publish",
    z.object({ entityId: z.string() }),
    async (event) => {
      publishedPhotoIds.add(`${event.user.tenantId}:${event.payload.entityId}`);
      return { isSuccess: true as const, data: { entityId: event.payload.entityId } };
    },
    { access: { openToAll: true } },
  );

  // Entry point 3 — default-deny. No registration here means every entityId
  // 404s; a registration that returns false does the same. Only an explicit
  // `true` serves bytes.
  r.useExtension(EXT_DERIVATIVE_PUBLIC_PREDICATE, "photo", {
    isPublic: ({ entityId, tenantId }: DerivativePublicPredicateArgs) =>
      publishedPhotoIds.has(`${tenantId}:${entityId}`),
  });
});
