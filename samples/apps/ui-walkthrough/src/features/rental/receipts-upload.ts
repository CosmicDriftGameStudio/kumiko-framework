import { createEntityExecutor, type WriteHandlerFn } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import {
  bindPendingFileRef,
  FILE_REF_ENTITY_NAME,
  fileRefEntity,
  loadPendingFileRef,
} from "@cosmicdrift/kumiko-framework/files";
import { z } from "zod";
import { receiptEntity } from "./entities";

const UPLOAD_SCREEN_QN = "rental:screen:upload-standard-layout";
const UPLOAD_FIELD = "belege";

const { executor: receiptExecutor } = createEntityExecutor("receipt", receiptEntity);
const { executor: fileRefExecutor } = createEntityExecutor(FILE_REF_ENTITY_NAME, fileRefEntity);

export const receiptsUploadPayloadSchema = z.object({
  belege: z.array(z.uuid()).min(1).max(10),
});

const unknownFile = () =>
  new UnprocessableError("unknown_upload", { i18nKey: "rental.upload.unknownFile" });

// The form only carries file ids. Each one must be the caller's own, still unbound upload of this
// form; everything is checked before the first receipt is written so a bad id creates nothing.
export const uploadReceipts: WriteHandlerFn<z.infer<typeof receiptsUploadPayloadSchema>> = async (
  event,
  ctx,
) => {
  const { user, payload } = event;
  const pendingNames: { readonly fileRefId: string; readonly fileName: string }[] = [];
  for (const fileRefId of new Set(payload.belege)) {
    const pending = await loadPendingFileRef({
      fileRefId,
      entityName: UPLOAD_SCREEN_QN,
      fieldName: UPLOAD_FIELD,
      user,
      db: ctx.db,
    });
    if (pending === undefined) throw unknownFile();
    // fileName is personal data and may be encrypted, so only the executor's detail returns it.
    const row = await fileRefExecutor.detail({ id: fileRefId }, user, ctx.db);
    if (row === null) throw unknownFile();
    pendingNames.push({ fileRefId, fileName: String(row["fileName"]) });
  }

  const belege: { readonly label: string }[] = [];
  for (const { fileRefId, fileName } of pendingNames) {
    const created = await receiptExecutor.create(
      { datei: fileRefId, dateiname: fileName },
      user,
      ctx.db,
    );
    if (!created.isSuccess) return created;
    const outcome = await bindPendingFileRef({
      fileRefId,
      entityName: UPLOAD_SCREEN_QN,
      fieldName: UPLOAD_FIELD,
      entityId: String(created.data.id),
      bindTo: { entityName: "receipt", fieldName: "datei" },
      registry: ctx.registry,
      user,
      db: ctx.db,
    });
    if (outcome !== "bound") throw unknownFile();
    belege.push({ label: fileName });
  }
  return { isSuccess: true, data: { count: belege.length, belege } };
};
