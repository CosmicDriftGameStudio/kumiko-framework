import { piiCiphertextMaxLengthFor } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEntity,
  createEntityExecutor,
  createFileField,
  createNumberField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import { INBOUND_ITEM_ENTITY, RELATIVE_PATH_MAX_LENGTH } from "../constants.ts";

export const inboundItemEntity = createEntity({
  name: INBOUND_ITEM_ENTITY,
  table: "read_connector_inbound_items",
  description:
    "One file a connector delivered: the stored file, its path below the connector's source, its SHA-256 and the source's modification time. Its created event is the moment the file was received; the bytes live in the file store, never in the event.",
  fields: {
    connectorId: createTextField({
      required: true,
      maxLength: 36,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
    // Null at the device root.
    folderId: createTextField({
      maxLength: 36,
      filterable: true,
      personal: false,
      reason: "technical_reference",
    }),
    fileRefId: createFileField({ personal: false, reason: "technical_reference" }),
    relativePath: createTextField({
      required: true,
      maxLength: piiCiphertextMaxLengthFor(RELATIVE_PATH_MAX_LENGTH),
      personal: "tenant",
      find: "none",
    }),
    sha256: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "is_document_hash",
    }),
    sizeBytes: createNumberField({ required: true }),
    sourceModifiedAt: createTimestampField({
      required: true,
      personal: false,
      reason: "is_business_timestamp",
    }),
  },
  indexes: [{ columns: ["connectorId", "folderId"] }],
});

export const { table: inboundItemTable, executor: inboundItemExecutor } =
  createEntityExecutor(inboundItemEntity);
