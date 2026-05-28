// Files Post-Processing Sample
//
// Shows the async handoff between an HTTP upload and a Kumiko-native
// event handler — and proves the "storage-key is the pointer, binary
// stays in storage" contract:
//
//   1. Client does POST /api/files with multipart body.
//   2. file-routes.ts validates + writes the binary to the registered
//      FileStorageProvider, then atomically inserts FileRef +
//      appends `fileRef.created` (Entity-Standard-Verb) into the
//      event-store.
//   3. The event-dispatcher picks up the committed event and invokes
//      every matching r.multiStreamProjection at-least-once.
//   4. Our MSP here reads the binary back via `ctx.files.ref(key).read()`
//      (no binary ever travelled through the event payload), "processes"
//      it (here: identity transform — in real life sharp-resize),
//      and writes the result under a derived key via
//      `handle.derive("thumb").write(...)`.
//
// This is how beammycar's Image-Feature should plug in resize / EXIF-strip /
// virus-scan etc. — each as its own small feature with a single MSP.

import { entityEventName } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FILE_REF_CREATED = entityEventName("fileRef", "created");

type FileRefCreatedPayload = {
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
};

// Exported so the integration test can assert which derivates got produced
// and reset between cases. Real consumers would push to a queue, write a
// row, or call out to an external service.
export const derivateLog: { readonly originalKey: string; readonly derivateKey: string }[] = [];

export const filesPostProcessingFeature = defineFeature("files-post-processing", (r) => {
  r.multiStreamProjection({
    name: "image-thumb",
    apply: {
      // MultiStreamApplyFn signature is (event, tx, ctx). The tx is the
      // dispatcher's live transaction — useful for writing follow-up rows
      // in the same commit. Here we only need ctx.files, so tx goes
      // unused.
      [FILE_REF_CREATED]: async (event, _tx, ctx) => {
        // entity-event payloads sind generisch `Record<string, unknown>`.
        // Mit der lokalen Shape oben narrowen wir an der MSP-Boundary,
        // statt jeden Feld-Zugriff einzeln zu casten.
        const payload = event.payload as FileRefCreatedPayload;

        // Skip non-images. Keeping the check on content type (not the filename
        // extension) matches what the upload route already validated.
        if (!payload.mimeType.startsWith("image/")) return;

        // ctx.files is populated by buildServer when a storageProvider is
        // registered. Defensive early-return keeps the projection safe for
        // test stacks that deliberately omit the provider.
        if (!ctx.files) return;

        const src = ctx.files.ref(payload.storageKey);
        const original = await src.read();

        // "Processing" — identity transform for the sample. Swap in
        // sharp(original).resize(200, 200).toBuffer() etc. in real features.
        const thumbHandle = src.derive("thumb");
        await thumbHandle.write(original, payload.mimeType);

        derivateLog.push({ originalKey: src.key, derivateKey: thumbHandle.key });
      },
    },
  });
});
