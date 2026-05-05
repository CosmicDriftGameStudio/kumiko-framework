// Files Post-Processing Sample
//
// Shows the async handoff between an HTTP upload and a Kumiko-native
// event handler — and proves the "storage-key is the pointer, binary
// stays in storage" contract:
//
//   1. Client does POST /api/files with multipart body.
//   2. file-routes.ts validates + writes the binary to the registered
//      FileStorageProvider, then atomically inserts FileRef +
//      appends `files:event:uploaded` into the event-store.
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

import { defineFeature, typedPayload } from "@cosmicdrift/kumiko-framework/engine";
import { fileUploadedEvent } from "@cosmicdrift/kumiko-framework/files";

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
      [fileUploadedEvent.name]: async (event, _tx, ctx) => {
        // typedPayload narrows the raw StoredEvent.payload to the
        // EventDef's inferred shape at runtime AND at compile time —
        // no more `as unknown as FileUploadedPayload` escape hatches.
        const payload = typedPayload(event, fileUploadedEvent);

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
